/**
 * 就業構造基本調査（年収分布 × 都道府県/政令市）
 * ================================================
 * statsDataId: 0004008500
 *   男女、配偶関係、従業上の地位・雇用形態・起業の有無、
 *   所得（主な仕事からの年間収入・収益）、年齢別人口（有業者）
 *   − 全国、都道府県、政令指定都市、県庁所在都市、人口30万以上の市
 *
 * 調査年: 令和4年（2022）— 5年に1度の調査、最新
 *
 * 関連 cat:
 *   cat01 男女 = "0" 総数
 *   cat02 配偶関係 = "0" 総数
 *   cat03 従業上の地位 = "0" 総数
 *   cat04 所得（17 bin：50万未満、50-99、…、1500万以上、"00"総数）
 *   cat05 年齢 = "00" 総数
 *
 * 投資観点:
 *   - 500万円以上比率: 基本購買力指標
 *   - 700万円以上比率: 中産以上（不動産投資の主要顧客層）
 *   - 1000万円以上比率: 高所得層（高級物件需要）
 *   - 推定中位収入帯: 賃料上限逆算（1/3 rule）
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0004008500'

// cat04 所得 bin 対応（人数単位）
const INCOME_BINS: Array<{ code: string; label: string; midMan: number }> = [
  { code: '01', label: '50万未満',  midMan: 25 },
  { code: '02', label: '50-99',    midMan: 75 },
  { code: '03', label: '100-149',  midMan: 125 },
  { code: '04', label: '150-199',  midMan: 175 },
  { code: '05', label: '200-249',  midMan: 225 },
  { code: '06', label: '250-299',  midMan: 275 },
  { code: '07', label: '300-399',  midMan: 350 },
  { code: '08', label: '400-499',  midMan: 450 },
  { code: '09', label: '500-599',  midMan: 550 },
  { code: '10', label: '600-699',  midMan: 650 },
  { code: '11', label: '700-799',  midMan: 750 },
  { code: '12', label: '800-899',  midMan: 850 },
  { code: '13', label: '900-999',  midMan: 950 },
  { code: '14', label: '1000-1249', midMan: 1125 },
  { code: '15', label: '1250-1499', midMan: 1375 },
  { code: '16', label: '1500+',     midMan: 1800 },
]

export interface EmploymentIncome {
  areaName: string
  areaCode: string
  totalWorkers: number
  above500mRatio: number   // 年収 500 万円以上の比率
  above700mRatio: number   // 年収 700 万円以上の比率
  above1000mRatio: number  // 年収 1000 万円以上の比率
  medianIncomeMan: number  // 推定中位所得（万円）
  /** 月額家賃負担能力の目安（中位所得 × 30% ÷ 12） */
  affordableMonthlyRentJpy: number
  year: number
  source: string
}

export async function getEmploymentIncome(
  address: string,
): Promise<EmploymentIncome | null> {
  const area = resolveArea(address)
  if (!area) return null

  const candidates = [
    { code: area.majorCityCode5, name: area.majorCityName },
    { code: area.prefCode2 + '000', name: area.prefName },
  ]

  let values: ReturnType<typeof getValues> = []
  let used = candidates[0]
  for (const c of candidates) {
    const resp = await fetchStatsData(STATS_ID, {
      cdArea: c.code,
      cdCat01: '0', cdCat02: '0', cdCat03: '0', cdCat05: '00',
    }, 86400 * 30)
    values = getValues(resp)
    if (values.length > 0 && values.some(v => toNumber(v['$']) !== undefined)) {
      used = c
      break
    }
  }

  if (values.length === 0) return null

  const byCat04: Record<string, number> = {}
  for (const v of values) {
    const k = v['@cat04']
    const n = toNumber(v['$']) ?? 0
    if (k) byCat04[k] = n
  }

  const total = byCat04['00']
  if (!total || total === 0) return null

  const above500 = ['09','10','11','12','13','14','15','16'].reduce((s, k) => s + (byCat04[k] ?? 0), 0)
  const above700 = ['11','12','13','14','15','16'].reduce((s, k) => s + (byCat04[k] ?? 0), 0)
  const above1000 = ['14','15','16'].reduce((s, k) => s + (byCat04[k] ?? 0), 0)

  // 推定中位所得（累計 50% に達する bin の中央値）
  const validBins = INCOME_BINS.map(b => ({ ...b, n: byCat04[b.code] ?? 0 }))
    .filter(b => b.n > 0)
  const totalBinned = validBins.reduce((s, b) => s + b.n, 0)
  let cum = 0
  let medianMan = 0
  for (const b of validBins) {
    cum += b.n
    if (cum >= totalBinned / 2) { medianMan = b.midMan; break }
  }

  return {
    areaName: used.name,
    areaCode: used.code,
    totalWorkers: total,
    above500mRatio: above500 / total,
    above700mRatio: above700 / total,
    above1000mRatio: above1000 / total,
    medianIncomeMan: medianMan,
    affordableMonthlyRentJpy: Math.round(medianMan * 10000 * 0.3 / 12),
    year: 2022,
    source: '令和4年就業構造基本調査',
  }
}
