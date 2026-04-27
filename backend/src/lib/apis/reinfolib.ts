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

// ─── reinfolib 共通 fetch（query-based、Path-based は 404 を返す）─────────────
// 全 API endpoint は ?response_format=geojson&z&x&y 形式（XKT002 / XPT002 manual 確認済み）
// 旧 path-based ${BASE_URL}/XKT002/${z}/${x}/${y}.geojson は全て 404
async function fetchReinfolibTile<T = unknown>(
  endpoint: string,
  lat: number,
  lng: number,
  zoom: number = 13,
  extraParams: Record<string, string> = {},
  revalidate: number = 86400,
): Promise<T | null> {
  try {
    const { x, y, z } = latLngToTile(lat, lng, zoom)
    const url = new URL(`${BASE_URL}/${endpoint}`)
    url.searchParams.set('response_format', 'geojson')
    url.searchParams.set('z', String(z))
    url.searchParams.set('x', String(x))
    url.searchParams.set('y', String(y))
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v)

    const res = await fetch(url.toString(), {
      headers: headers(),
      next: { revalidate },
    })

    if (res.status === 404) return null
    if (!res.ok) {
      console.error(`[Reinfolib] ${endpoint} error: ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error(`[Reinfolib] ${endpoint} fetch failed:`, e)
    return null
  }
}

// ─── 洪水浸水想定区域 ─────────────────────────────────────────────────────────

export async function getFloodRisk(
  lat: number,
  lng: number,
): Promise<{ risk: FloodRisk; depthM?: number } | null> {
  // XKT007: 洪水浸水想定区域（想定最大規模）— zoom 11-15
  const data = await fetchReinfolibTile<{ features?: Array<{ properties?: { depth?: string; rank?: string } }> }>(
    'XKT007', lat, lng, 13,
  )
  if (data == null) return { risk: 'none' }
  const features = data.features ?? []
  if (features.length === 0) return { risk: 'none' }

  // 浸水深から risk レベルを判定
  const depths = features
    .map(f => {
      const depthStr = f.properties?.depth ?? f.properties?.rank ?? ''
      const depthNum = parseFloat(depthStr.replace(/[^0-9.]/g, ''))
      return isNaN(depthNum) ? 0 : depthNum
    })
    .filter((d: number) => d > 0)

  const maxDepth = depths.length > 0 ? Math.max(...depths) : 0

  let risk: FloodRisk = 'low'
  if (maxDepth >= 5)      risk = 'very_high'
  else if (maxDepth >= 3) risk = 'high'
  else if (maxDepth >= 1) risk = 'medium'
  else if (maxDepth > 0)  risk = 'low'

  return { risk, depthM: maxDepth || undefined }
}

// ─── 土砂災害警戒区域 ─────────────────────────────────────────────────────────

export async function getLandslideRisk(
  lat: number,
  lng: number,
): Promise<LandslideRisk | null> {
  // XKT011: 土砂災害警戒区域（急傾斜地の崩壊）
  const data = await fetchReinfolibTile<{ features?: Array<{ properties?: { type?: string } }> }>(
    'XKT011', lat, lng, 13,
  )
  if (data == null) return 'none'
  const features = data.features ?? []
  if (features.length === 0) return 'none'

  // 特別警戒区域（レッドゾーン）があれば high
  const hasSpecial = features.some(f => f.properties?.type?.includes('特別'))
  return hasSpecial ? 'high' : 'medium'
}

// ─── 津波浸水想定 ─────────────────────────────────────────────────────────────

export async function getTsunamiRisk(
  lat: number,
  lng: number,
): Promise<{ risk: TsunamiRisk; depthM?: number } | null> {
  // XKT009: 津波浸水想定
  const data = await fetchReinfolibTile<{ features?: Array<{ properties?: { depth?: string } }> }>(
    'XKT009', lat, lng, 13,
  )
  if (data == null) return { risk: 'none' }
  const features = data.features ?? []
  if (features.length === 0) return { risk: 'none' }

  const depths = features
    .map(f => parseFloat(f.properties?.depth?.replace(/[^0-9.]/g, '') ?? '0'))
    .filter((d: number) => !isNaN(d) && d > 0)

  const maxDepth = depths.length > 0 ? Math.max(...depths) : 0

  let risk: TsunamiRisk = 'low'
  if (maxDepth >= 10)     risk = 'high'
  else if (maxDepth >= 3) risk = 'medium'

  return { risk, depthM: maxDepth || undefined }
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
  // XKT002: 都市計画決定GISデータ（用途地域）
  // 実 properties: use_area_ja / u_building_coverage_ratio_ja「80%」/ u_floor_area_ratio_ja「500%」
  // ※ 防火地域情報は XKT002 には含まれない（別 endpoint XKT003 などにあるが本 dataset では取得不可）
  type ZonFeature = {
    properties?: {
      use_area_ja?: string
      u_building_coverage_ratio_ja?: string
      u_floor_area_ratio_ja?: string
    }
  }
  const data = await fetchReinfolibTile<{ features?: ZonFeature[] }>(
    'XKT002', lat, lng, 13, {}, 604800,
  )
  if (data == null) return null
  const features = data.features ?? []
  if (features.length === 0) return null

  // 一番近い feature のプロパティを採用（タイルにしか絞れないので最初の feature を採用）
  const p = features[0].properties ?? {}

  const categoryName = (p.use_area_ja ?? '').trim()
  const category = (VALID_ZONING.includes(categoryName as ZoningCategory)
    ? categoryName
    : 'unknown') as ZoningCategory

  // 「80%」→ 80, 「500%」→ 500
  const bcr = parseFloat((p.u_building_coverage_ratio_ja ?? '').replace(/[^0-9.]/g, ''))
  const far = parseFloat((p.u_floor_area_ratio_ja ?? '').replace(/[^0-9.]/g, ''))

  return {
    category,
    buildingCoverageRatio: isFinite(bcr) ? bcr : undefined,
    floorAreaRatio:        isFinite(far) ? far : undefined,
    fireZone: 'none', // XKT002 には防火地域情報なし
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
): Promise<OfficialLandPrice | null> {
  // XPT002: 地価公示・地価調査のポイント API（zoom 13-15、year は前年=最新）
  type LandFeature = {
    geometry?: { coordinates?: [number, number] }
    properties?: Record<string, unknown>
  }
  const lastYear = String(new Date().getFullYear() - 1)
  const data = await fetchReinfolibTile<{ features?: LandFeature[] }>(
    'XPT002', lat, lng, 13,
    { year: lastYear },
    2592000, // 30日キャッシュ
  )
  if (data == null) return null
  const features = data.features ?? []
  if (features.length === 0) return null

  // 最も近い地点を選ぶ
  const nearest = features
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
  // 実 properties:
  //   u_current_years_price_ja: '1,030,000(円/㎡)'  ← 当年公示地価
  //   last_years_price: 968000                       ← 前年公示地価（純数値）
  //   target_year_name_ja: '令和6年1月1日'
  //   use_category_name_ja: '住宅地'
  //   nearest_station_name_ja: '中目黒'
  //   u_road_distance_to_nearest_station_name_ja: '550m'
  const priceStr = String(p['u_current_years_price_ja'] ?? '')
  const priceParsed = parseFloat(priceStr.replace(/[^0-9.]/g, ''))
  const price = isFinite(priceParsed) && priceParsed > 0
    ? priceParsed
    : Number(p['last_years_price'] ?? 0)
  if (!price || price <= 0) return null

  // 「令和6年1月1日」→ 2024 / 「平成31年」→ 2019
  const yearStr = String(p['target_year_name_ja'] ?? '')
  let year = new Date().getFullYear()
  const reiwa = yearStr.match(/令和(\d+)/)
  const heisei = yearStr.match(/平成(\d+)/)
  const seireki = yearStr.match(/(\d{4})年/)
  if (reiwa)        year = 2018 + parseInt(reiwa[1], 10)
  else if (heisei)  year = 1988 + parseInt(heisei[1], 10)
  else if (seireki) year = parseInt(seireki[1], 10)

  const distRaw = String(p['u_road_distance_to_nearest_station_name_ja'] ?? '')
  const distNum = parseFloat(distRaw.replace(/[^0-9.]/g, ''))

  return {
    pricePerSqm: price,
    year,
    useCategory:        String(p['use_category_name_ja'] ?? p['usage_category_name_ja'] ?? ''),
    nearestStation:     p['nearest_station_name_ja'] ? String(p['nearest_station_name_ja']) : undefined,
    distanceToStationM: isFinite(distNum) ? distNum : undefined,
    distanceToSiteM:    Math.round(nearest.dist),
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
