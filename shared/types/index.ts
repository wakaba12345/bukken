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
  rawData?: Record<string, unknown>
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
  earthquake30yr: number    // 30年以内震度6強以上確率 (0-1)
  floodRisk: 'none' | 'low' | 'medium' | 'high' | 'very_high'
  landslideRisk: 'none' | 'low' | 'medium' | 'high'
  tsunamiRisk: 'none' | 'low' | 'medium' | 'high'
  overallScore: number      // 0-100 (100 = safest)
}

export interface AreaMarket {
  avgPricePerSqm: number    // 円/㎡
  recentTransactions: number // 直近6ヶ月取引件数
  priceChange6m: number     // 価格変動率 (%)
  estimatedRent?: number    // 推定賃料 円/月
  estimatedYield?: number   // 推定利回り (%)
}

export interface ReportContent {
  type: ReportType
  property: PropertyData
  crossPlatform?: CrossPlatformResult
  disasterRisk?: DisasterRisk
  areaMarket?: AreaMarket
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
  code?: 'INSUFFICIENT_POINTS' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INTERNAL_ERROR'
}
