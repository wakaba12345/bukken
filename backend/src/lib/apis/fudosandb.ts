/**
 * FUDOSAN DB API (Cabocia株式会社)
 *
 * ⚠️ 2026年現在: `api.fudosandb.jp` は DNS 解決不可（サービス終了か domain 変更）。
 * 再申請 / 新 domain が判明するまで graceful disabled。
 * 賃料推定は Claude AI の prompt 内で推論させる、または将来 reinfolib + 独自モデルに置換予定。
 */

import type { AreaMarket } from 'shared/types'

const BASE_URL = 'https://api.fudosandb.jp/v1'
const SERVICE_DISABLED = !process.env.FUDOSAN_DB_API_KEY // key 未設定時は自動的に disable

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.FUDOSAN_DB_API_KEY ?? '',
  }
}

// ─── 賃料推定 ─────────────────────────────────────────────────────────────────

interface RentEstimateRequest {
  address: string
  area: number       // ㎡
  age?: number       // 築年数
  floor?: number     // 階
}

interface RentEstimateResponse {
  estimated_rent: number        // 月額賃料（円）
  confidence: 'high' | 'medium' | 'low'
  mape: number                  // 予測誤差率
  similar_properties?: {
    rent: number
    area: number
    distance_m: number
  }[]
}

export async function estimateRent(
  params: RentEstimateRequest,
): Promise<RentEstimateResponse | null> {
  if (SERVICE_DISABLED) return null
  try {
    const res = await fetch(`${BASE_URL}/rent/estimate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(params),
      next: { revalidate: 3600 }, // 1時間キャッシュ
    })

    if (!res.ok) {
      console.error('[FUDOSAN DB] rent estimate error:', res.status, await res.text())
      return null
    }

    return await res.json()
  } catch (e) {
    console.error('[FUDOSAN DB] estimateRent failed:', e)
    return null
  }
}

// ─── エリア詳細 ───────────────────────────────────────────────────────────────

interface AreaDetailResponse {
  area_name: string
  avg_price_per_sqm: number     // 円/㎡
  avg_rent_per_sqm: number      // 円/㎡
  transaction_count_6m: number  // 直近6ヶ月取引件数
  price_change_6m: number       // 価格変動率 (%)
  price_change_1y: number       // 1年変動率 (%)
  population_trend: 'growing' | 'stable' | 'declining'
  disaster_risk_score: number   // 0-100 (100=最安全)
}

export async function getAreaDetail(
  lat: number,
  lng: number,
): Promise<AreaDetailResponse | null> {
  if (SERVICE_DISABLED) return null
  try {
    const res = await fetch(
      `${BASE_URL}/area/detail?lat=${lat}&lng=${lng}`,
      {
        headers: headers(),
        next: { revalidate: 86400 }, // 24時間キャッシュ
      }
    )

    if (!res.ok) {
      console.error('[FUDOSAN DB] area detail error:', res.status)
      return null
    }

    return await res.json()
  } catch (e) {
    console.error('[FUDOSAN DB] getAreaDetail failed:', e)
    return null
  }
}

// ─── エリア比較 ───────────────────────────────────────────────────────────────

interface AreaCompareResponse {
  areas: {
    name: string
    avg_price_per_sqm: number
    avg_yield: number
    safety_score: number
    population_trend: string
  }[]
}

export async function compareAreas(
  areaNames: string[],
): Promise<AreaCompareResponse | null> {
  if (SERVICE_DISABLED) return null
  try {
    const res = await fetch(`${BASE_URL}/area/compare`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ areas: areaNames }),
      next: { revalidate: 86400 },
    })

    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('[FUDOSAN DB] compareAreas failed:', e)
    return null
  }
}

// ─── 統合: reportService から呼ぶメインの関数 ─────────────────────────────────

export async function getAreaMarket(
  address: string,
  lat: number,
  lng: number,
  propertyArea?: number,
  propertyAge?: number,
): Promise<AreaMarket | null> {
  const [areaDetail, rentEstimate] = await Promise.allSettled([
    getAreaDetail(lat, lng),
    propertyArea
      ? estimateRent({ address, area: propertyArea, age: propertyAge })
      : Promise.resolve(null),
  ])

  const area = areaDetail.status === 'fulfilled' ? areaDetail.value : null
  const rent = rentEstimate.status === 'fulfilled' ? rentEstimate.value : null

  if (!area) return null

  const estimatedRent = rent?.estimated_rent
  const estimatedYield =
    estimatedRent && area.avg_price_per_sqm && propertyArea
      ? (estimatedRent * 12) / (area.avg_price_per_sqm * propertyArea) * 100
      : undefined

  return {
    avgPricePerSqm: area.avg_price_per_sqm,
    recentTransactions: area.transaction_count_6m,
    priceChange6m: area.price_change_6m,
    estimatedRent,
    estimatedYield,
  }
}
