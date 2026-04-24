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

// ─── 用途地域（Zoning） ───────────────────────────────────────────────────────

export type ZoningCategory =
  | '第一種低層住居専用地域'
  | '第二種低層住居専用地域'
  | '第一種中高層住居専用地域'
  | '第二種中高層住居専用地域'
  | '第一種住居地域'
  | '第二種住居地域'
  | '準住居地域'
  | '田園住居地域'
  | '近隣商業地域'
  | '商業地域'
  | '準工業地域'
  | '工業地域'
  | '工業専用地域'
  | 'unknown'

export interface ZoningInfo {
  category: ZoningCategory
  buildingCoverageRatio?: number  // 建蔽率（%）
  floorAreaRatio?: number         // 容積率（%）
  fireZone?: 'none' | 'semi_fire' | 'fire'
}

export async function getZoning(lat: number, lng: number): Promise<ZoningInfo | null> {
  try {
    const { x, y, z } = latLngToTile(lat, lng, 15)

    // XKT002: 都市計画決定GISデータ（用途地域）
    const res = await fetch(
      `${BASE_URL}/XKT002/${z}/${x}/${y}.geojson`,
      {
        headers: headers(),
        next: { revalidate: 604800 }, // 用途地域は変更頻度が低い（7日キャッシュ）
      }
    )

    if (res.status === 404) return null
    if (!res.ok) {
      console.error('[Reinfolib] zoning error:', res.status)
      return null
    }

    const data = await res.json()
    const features = data?.features ?? []
    if (features.length === 0) return null

    // 一番近い feature のプロパティを採用（タイルにしか絞れないので）
    const feat = features[0] as {
      properties?: {
        youto?: string
        kenpei?: string | number
        youseki?: string | number
        bouka?: string
      }
    }
    const p = feat.properties ?? {}

    const categoryName = (p.youto ?? '').trim()
    const category = (VALID_ZONING.includes(categoryName as ZoningCategory)
      ? categoryName
      : 'unknown') as ZoningCategory

    const bcr = typeof p.kenpei === 'number' ? p.kenpei : parseFloat(String(p.kenpei ?? ''))
    const far = typeof p.youseki === 'number' ? p.youseki : parseFloat(String(p.youseki ?? ''))

    const boukaStr = (p.bouka ?? '').toString()
    const fireZone = boukaStr.includes('準防火') ? 'semi_fire'
                   : boukaStr.includes('防火')    ? 'fire'
                   : 'none'

    return {
      category,
      buildingCoverageRatio: isNaN(bcr) ? undefined : bcr,
      floorAreaRatio:        isNaN(far) ? undefined : far,
      fireZone,
    }
  } catch (e) {
    console.error('[Reinfolib] getZoning failed:', e)
    return null
  }
}

const VALID_ZONING: ZoningCategory[] = [
  '第一種低層住居専用地域', '第二種低層住居専用地域',
  '第一種中高層住居専用地域', '第二種中高層住居専用地域',
  '第一種住居地域', '第二種住居地域', '準住居地域', '田園住居地域',
  '近隣商業地域', '商業地域',
  '準工業地域', '工業地域', '工業専用地域',
]

// ─── 地価公示・地価調査（Official Land Price） ──────────────────────────────

export interface OfficialLandPrice {
  pricePerSqm: number           // 円/㎡
  year: number                  // 基準年
  useCategory: string           // 用途（住宅・商業・工業）
  nearestStation?: string
  distanceToStationM?: number
  distanceToSiteM: number       // 物件から基準地点までの距離
}

export async function getOfficialLandPrice(
  lat: number,
  lng: number,
  radiusKm: number = 1.0,
): Promise<OfficialLandPrice | null> {
  try {
    // XPT002: 地価公示・地価調査のポイント API
    const url = new URL(`${BASE_URL}/XPT002`)
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lng', String(lng))
    url.searchParams.set('radius', String(radiusKm * 1000))
    url.searchParams.set('limit', '10')

    const res = await fetch(url.toString(), {
      headers: headers(),
      next: { revalidate: 2592000 }, // 30日（地価公示は年1回更新）
    })

    if (!res.ok) {
      console.error('[Reinfolib] land price error:', res.status)
      return null
    }

    const data = await res.json()
    const features = data?.features ?? []
    if (features.length === 0) return null

    // 最も近い地点を選ぶ
    type LandFeature = {
      geometry?: { coordinates?: [number, number] }
      properties?: Record<string, unknown>
    }
    const nearest = (features as LandFeature[])
      .map(f => {
        const coords = f.geometry?.coordinates
        if (!coords || coords.length < 2) return null
        const [flng, flat] = coords
        const dist = haversineMeters(lat, lng, flat, flng)
        return { feature: f, dist }
      })
      .filter((x): x is { feature: LandFeature; dist: number } => x !== null)
      .sort((a, b) => a.dist - b.dist)[0]

    if (!nearest) return null

    const p = nearest.feature.properties ?? {}
    const price = Number(p['価格'] ?? p['価格（円/㎡）'] ?? p['pricePerSqm'] ?? 0)
    if (price <= 0) return null

    return {
      pricePerSqm: price,
      year: Number(p['年'] ?? p['基準年'] ?? new Date().getFullYear()),
      useCategory:        String(p['用途'] ?? p['利用区分'] ?? ''),
      nearestStation:     p['最寄駅'] ? String(p['最寄駅']) : undefined,
      distanceToStationM: p['駅距離'] ? Number(p['駅距離']) : undefined,
      distanceToSiteM:    Math.round(nearest.dist),
    }
  } catch (e) {
    console.error('[Reinfolib] getOfficialLandPrice failed:', e)
    return null
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (x: number) => x * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─── 取引価格情報 ─────────────────────────────────────────────────────────────

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
