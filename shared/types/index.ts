// ─── Property ───────────────────────────────────────────────────────────────

export type Platform = 'suumo' | 'athome' | 'homes' | 'rakumachi' | 'kenbiya' | 'fudosan_japan' | 'unknown'

export interface PropertyData {
  id?: string
  url: string
  platform: Platform
  // 物件基本資訊
  name?: string          // 建物名
  address: string        // 住所
  lat?: number
  lng?: number
  price: number          // 円
  area: number           // ㎡
  age?: number           // 築年数
  floor?: string         // 階数（例: "3F / 10F"）
  managementFee?: number // 管理費（円/月）
  transport?: string[]   // 交通アクセス
  structure?: string         // 構造（RC造、SRC造、鉄骨造、木造 等）
  layout?: string            // 間取り（例: "1K", "2LDK"）
  seismicRetrofit?: boolean  // 旧耐震物件で耐震補強工事済か（true=補強済、undefined=不明）
  features?: PropertyFeatures
  rawData?: Record<string, unknown>
}

export interface PropertyFeatures {
  autolock?: boolean              // オートロック
  bathToiletSeparate?: boolean    // バス・トイレ別（true=分離 / false=ユニット一体）
  balcony?: boolean               // バルコニー
  washerIndoor?: boolean          // 洗濯機置場（true=室内 / false=共用 or 屋外）
  bathtub?: boolean               // 浴槽（false=シャワーのみ → 日本人テナント嫌避）
}

export interface CrossPlatformResult {
  currentPlatform: Platform
  currentPrice: number
  otherListings: {
    platform: Platform
    price: number
    url: string
  }[]
  lowestPrice: number
  lowestPlatform: Platform
  priceDiff: number      // currentPrice - lowestPrice（正=今見てる方が高い）
  confidence: 'high' | 'medium' | 'low'
}

// ─── Points ─────────────────────────────────────────────────────────────────

export type FeatureKey =
  | 'quick_summary'   // 6pt
  | 'standard_report' // 10pt
  | 'deep_report'     // 30pt
  | 'pdf_download'    // 1pt

export const POINT_COSTS: Record<FeatureKey, number> = {
  quick_summary: 6,
  standard_report: 10,
  deep_report: 30,
  pdf_download: 1,
}

export type PlanId = 'starter' | 'standard' | 'pro' | 'payg'

export interface Plan {
  id: PlanId
  nameJa: string
  nameZh: string
  points: number
  priceJpy: number
  validDays: number | null // null = payg
  perPointJpy: number
}

export const PLANS: Plan[] = [
  { id: 'starter',  nameJa: '入門パック',  nameZh: '入門包', points: 300,  priceJpy: 2980, validDays: 90,  perPointJpy: 9.93 },
  { id: 'standard', nameJa: 'スタンダード', nameZh: '標準包', points: 500,  priceJpy: 4480, validDays: 180, perPointJpy: 8.96 },
  { id: 'pro',      nameJa: 'プロパック',  nameZh: '專業包', points: 1000, priceJpy: 7800, validDays: 365, perPointJpy: 7.80 },
  { id: 'payg',     nameJa: '従量課金',    nameZh: '按量付費', points: 0,   priceJpy: 12,   validDays: null, perPointJpy: 12 },
]

// ─── Report ──────────────────────────────────────────────────────────────────

export type ReportType = 'quick_summary' | 'standard' | 'deep'

export interface DisasterRisk {
  earthquake30yr?: number   // 30年以内震度6強以上確率 (0-1)；undefined = J-SHIS API 失敗／取得不可
  floodRisk: 'none' | 'low' | 'medium' | 'high' | 'very_high'
  landslideRisk: 'none' | 'low' | 'medium' | 'high'
  tsunamiRisk: 'none' | 'low' | 'medium' | 'high'
  overallScore?: number     // 0-100 (100 = safest)；undefined = 全ハザード API 失敗のため計算不可
}

export interface AreaMarket {
  avgPricePerSqm: number    // 円/㎡
  recentTransactions: number // 直近6ヶ月取引件数
  priceChange6m: number     // 価格変動率 (%)
  estimatedRent?: number    // 推定賃料 円/月
  estimatedYield?: number   // 推定利回り (%)
}

export type AreaHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type AreaTrend = 'rising' | 'stable' | 'declining'

export interface AreaHealthScore {
  areaName: string
  overallScore: number              // 0-100
  grade: AreaHealthGrade
  trend: AreaTrend
  subScores: {
    demand: number                  // 0-100 (popMove + population + foreignRes)
    supply: number                  // 0-100 (vacancy + construction 反向)
    purchasingPower: number         // 0-100 (employment)
  }
  keyInsights: string[]             // ポジティブ要因 2-5 条
  riskFlags: string[]               // ネガティブ要因 / 警告 0-5 条
  dataCompleteness: number          // 0-1（1 = 全 6 資料源あり）
}

export interface ZoningInfo {
  category: string                           // 用途地域名（例: 第一種低層住居専用地域）
  buildingCoverageRatio?: number             // 建蔽率 %
  floorAreaRatio?: number                    // 容積率 %
  fireZone?: 'none' | 'semi_fire' | 'fire'   // 防火地域区分
}

export interface VisionAnalysis {
  overall_score: number              // 0-100
  risk_level: string                 // '低風險' | '注意' | '警示' | '高風險'
  summary: string
  details: {
    garbage_area?:    { visible: boolean; condition: string | null; risk: string; note: string }
    balconies?:       { hoarding: boolean; dead_plants: boolean; excessive_laundry: boolean; risk: string; note: string }
    exterior?:        { tile_damage: boolean; graffiti: boolean; condition: string; note: string }
    common_area?:     { decorations: boolean; personal_items: boolean; risk: string; note: string }
    mailbox_area?:    { visible: boolean; clean: boolean | null; ad_accumulation: string | null; damaged: boolean | null; note: string }
    bicycle_parking?: { visible: boolean; condition: string | null; abandoned_bikes: boolean | null; note: string }
    sunlight?:        { direction: string; surrounding_height: string; rating: string; note: string }
    environment?:     { street_cleanliness: string; area_type: string; note: string }
  }
  red_flags: string[]
  green_flags: string[]
  management_advice: string
  coordinates: { lat: number; lng: number }
}

export type SlopeRating = 'flat' | 'gentle' | 'moderate' | 'steep'

export interface SlopeAnalysis {
  center_m: number
  north_m: number
  east_m: number
  south_m: number
  west_m: number
  max_delta_m: number
  rating: SlopeRating
  note: string
}

export interface NearbyAmenity {
  type: 'convenience_store' | 'supermarket'
  name: string
  address?: string
  distance_m: number
  lat: number
  lng: number
}

export type AmenitiesRating = 'excellent' | 'good' | 'limited' | 'poor'

export interface AmenitiesCheck {
  convenience_stores: NearbyAmenity[]   // 半径 500m 以内
  supermarkets: NearbyAmenity[]         // 半径 800m 以内
  nearest_convenience_m: number | null
  nearest_supermarket_m: number | null
  rating: AmenitiesRating
  rating_note: string
  coordinates: { lat: number; lng: number }
}

export interface CemeteryNearby {
  name: string
  address?: string
  distance_m: number
  lat: number
  lng: number
}

export interface CemeteryCheck {
  found: boolean
  risk_level: string                 // '🔴 高度忌諱' | '🟠 注意' | '🟡 低度影響' | '🟢 影響なし'
  nearest_distance_m: number | null
  name: string | null
  taiwan_buyer_note: string
  all_within_200m: CemeteryNearby[]
  coordinates: { lat: number; lng: number }
}

export interface OfficialLandPrice {
  pricePerSqm: number                        // 円/㎡（公示地価）
  year: number
  useCategory: string                        // 住宅地・商業地・工業地など
  nearestStation?: string
  distanceToStationM?: number
  distanceToSiteM: number                    // 物件座標から最寄地点までの距離（m）
}

export interface ReportContent {
  type: ReportType
  property: PropertyData
  crossPlatform?: CrossPlatformResult
  disasterRisk?: DisasterRisk
  areaMarket?: AreaMarket
  zoning?: ZoningInfo                        // deep_report のみ
  officialLandPrice?: OfficialLandPrice      // deep_report のみ
  visionAnalysis?: VisionAnalysis            // Street View 外観気場分析
  cemeteryCheck?: CemeteryCheck              // 半径 200m 墓地検索
  amenitiesCheck?: AmenitiesCheck            // 便利商店・超市の充実度（賃貸需要に直接影響）
  slope?: SlopeAnalysis                       // 坡度（傾斜）解析（年配・子育てテナント影響）
  areaHealthScore?: AreaHealthScore          // e-Stat 多源集計
  aiAnalysis: {
    summary: string
    pros: string[]
    cons: string[]
    recommendation: string
    investmentScore?: number // 0-100
  }
  generatedAt: string       // ISO datetime
  pointsUsed: number
}

// ─── User ────────────────────────────────────────────────────────────────────

export type UserLocale = 'ja' | 'zh-TW'

export interface UserProfile {
  id: string
  email: string
  locale: UserLocale
  pointBalance: number
  createdAt: string
}

// ─── API responses ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  code?: 'INSUFFICIENT_POINTS' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'GOOGLE_KEY_NOT_CONFIGURED'
}
