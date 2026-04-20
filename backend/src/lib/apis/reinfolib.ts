/**
 * 不動産情報ライブラリ API — 国土交通省
 * https://www.reinfolib.mlit.go.jp/help/apiManual/
 *
 * 要申請: reinfolib.mlit.go.jp/api/request/
 * 審査約5営業日
 * .env.local に REINFOLIB_API_KEY を設定
 */

const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external'

function headers() {
  return {
    'Ocp-Apim-Subscription-Key': process.env.REINFOLIB_API_KEY!,
  }
}

// ─── 型定義 ───────────────────────────────────────────────────────────────────

type FloodRisk = 'none' | 'low' | 'medium' | 'high' | 'very_high'
type LandslideRisk = 'none' | 'low' | 'medium' | 'high'
type TsunamiRisk = 'none' | 'low' | 'medium' | 'high'

export interface DisasterRiskDetail {
  floodRisk: FloodRisk
  floodDepthM?: number         // 浸水深（m）
  landslideRisk: LandslideRisk
  tsunamiRisk: TsunamiRisk
  tsunamiDepthM?: number
}

// ─── タイル座標変換 ───────────────────────────────────────────────────────────

function latLngToTile(lat: number, lng: number, zoom: number) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom))
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * Math.pow(2, zoom)
  )
  return { x, y, z: zoom }
}

// ─── 洪水浸水想定区域 ─────────────────────────────────────────────────────────

export async function getFloodRisk(
  lat: number,
  lng: number,
): Promise<{ risk: FloodRisk; depthM?: number } | null> {
  try {
    const { x, y, z } = latLngToTile(lat, lng, 15)

    // 洪水浸水想定区域（想定最大規模）
    const res = await fetch(
      `${BASE_URL}/XKT007/${z}/${x}/${y}.geojson`,
      {
        headers: headers(),
        next: { revalidate: 86400 },
      }
    )

    if (res.status === 404) return { risk: 'none' }
    if (!res.ok) {
      console.error('[Reinfolib] flood risk error:', res.status)
      return null
    }

    const data = await res.json()
    const features = data?.features ?? []

    if (features.length === 0) return { risk: 'none' }

    // 浸水深から risk レベルを判定
    const depths = features
      .map((f: { properties?: { depth?: string; rank?: string } }) => {
        const depthStr = f.properties?.depth ?? f.properties?.rank ?? ''
        const depthNum = parseFloat(depthStr.replace(/[^0-9.]/g, ''))
        return isNaN(depthNum) ? 0 : depthNum
      })
      .filter((d: number) => d > 0)

    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0

    let risk: FloodRisk = 'low'
    if (maxDepth >= 5)    risk = 'very_high'
    else if (maxDepth >= 3) risk = 'high'
    else if (maxDepth >= 1) risk = 'medium'
    else if (maxDepth > 0)  risk = 'low'

    return { risk, depthM: maxDepth || undefined }
  } catch (e) {
    console.error('[Reinfolib] getFloodRisk failed:', e)
    return null
  }
}

// ─── 土砂災害警戒区域 ─────────────────────────────────────────────────────────

export async function getLandslideRisk(
  lat: number,
  lng: number,
): Promise<LandslideRisk | null> {
  try {
    const { x, y, z } = latLngToTile(lat, lng, 15)

    // 土砂災害警戒区域（急傾斜地の崩壊）
    const res = await fetch(
      `${BASE_URL}/XKT011/${z}/${x}/${y}.geojson`,
      {
        headers: headers(),
        next: { revalidate: 86400 },
      }
    )

    if (res.status === 404) return 'none'
    if (!res.ok) return null

    const data = await res.json()
    const features = data?.features ?? []

    if (features.length === 0) return 'none'

    // 特別警戒区域（レッドゾーン）があれば high
    const hasSpecial = features.some(
      (f: { properties?: { type?: string } }) =>
        f.properties?.type?.includes('特別')
    )

    return hasSpecial ? 'high' : 'medium'
  } catch (e) {
    console.error('[Reinfolib] getLandslideRisk failed:', e)
    return null
  }
}

// ─── 津波浸水想定 ─────────────────────────────────────────────────────────────

export async function getTsunamiRisk(
  lat: number,
  lng: number,
): Promise<{ risk: TsunamiRisk; depthM?: number } | null> {
  try {
    const { x, y, z } = latLngToTile(lat, lng, 15)

    const res = await fetch(
      `${BASE_URL}/XKT009/${z}/${x}/${y}.geojson`,
      {
        headers: headers(),
        next: { revalidate: 86400 },
      }
    )

    if (res.status === 404) return { risk: 'none' }
    if (!res.ok) return null

    const data = await res.json()
    const features = data?.features ?? []

    if (features.length === 0) return { risk: 'none' }

    const depths = features
      .map((f: { properties?: { depth?: string } }) =>
        parseFloat(f.properties?.depth?.replace(/[^0-9.]/g, '') ?? '0')
      )
      .filter((d: number) => !isNaN(d) && d > 0)

    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0

    let risk: TsunamiRisk = 'low'
    if (maxDepth >= 10)   risk = 'high'
    else if (maxDepth >= 3) risk = 'medium'

    return { risk, depthM: maxDepth || undefined }
  } catch (e) {
    console.error('[Reinfolib] getTsunamiRisk failed:', e)
    return null
  }
}

// ─── 統合: reportService から呼ぶメインの関数 ─────────────────────────────────

export async function getDisasterRisk(
  lat: number,
  lng: number,
): Promise<DisasterRiskDetail> {
  const [flood, landslide, tsunami] = await Promise.allSettled([
    getFloodRisk(lat, lng),
    getLandslideRisk(lat, lng),
    getTsunamiRisk(lat, lng),
  ])

  return {
    floodRisk:     flood.status === 'fulfilled'     ? (flood.value?.risk ?? 'none')     : 'none',
    floodDepthM:   flood.status === 'fulfilled'     ? flood.value?.depthM               : undefined,
    landslideRisk: landslide.status === 'fulfilled' ? (landslide.value ?? 'none')       : 'none',
    tsunamiRisk:   tsunami.status === 'fulfilled'   ? (tsunami.value?.risk ?? 'none')   : 'none',
    tsunamiDepthM: tsunami.status === 'fulfilled'   ? tsunami.value?.depthM             : undefined,
  }
}

// ─── 取引価格情報 ─────────────────────────────────────────────────────────────

export interface Transaction {
  price: number          // 円
  area: number           // ㎡
  pricePerSqm: number    // 円/㎡
  year: number
  quarter: number
  type: string           // 中古マンション etc.
}

export async function getRecentTransactions(
  lat: number,
  lng: number,
  radiusKm: number = 0.5,
): Promise<Transaction[]> {
  try {
    // 不動産取引価格情報
    const res = await fetch(
      `${BASE_URL}/XIT001?lat=${lat}&lng=${lng}&radius=${radiusKm * 1000}&limit=20`,
      {
        headers: headers(),
        next: { revalidate: 86400 },
      }
    )

    if (!res.ok) return []

    const data = await res.json()
    const features = data?.features ?? []

    return features
      .map((f: { properties?: Record<string, unknown> }) => {
        const p = f.properties ?? {}
        const price = Number(p['取引価格（総額）'] ?? 0)
        const area  = Number(p['面積（㎡）'] ?? 0)
        return {
          price,
          area,
          pricePerSqm: area > 0 ? Math.round(price / area) : 0,
          year:    Number(p['取引時期（年）'] ?? 0),
          quarter: Number(p['取引時期（四半期）'] ?? 0),
          type:    String(p['種類'] ?? ''),
        }
      })
      .filter((t: Transaction) => t.price > 0 && t.area > 0)
  } catch (e) {
    console.error('[Reinfolib] getRecentTransactions failed:', e)
    return []
  }
}
