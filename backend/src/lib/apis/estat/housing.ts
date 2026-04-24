/**
 * 住宅・土地統計調査 令和5年（2023）空屋率
 * ==========================================
 * statsDataId: 0004021421
 *   住宅及び世帯総数 居住世帯の有無(8区分)別住宅数
 *   − 全国、都道府県、市区町村（1283 area 粒度、個別区まで対応）
 *
 * cat01（居住世帯の有無）:
 *   "0"   総数 ← 分母
 *   "1"   居住世帯あり
 *   "2"   居住世帯なし
 *   "22"  空き家 ← 分子（全体）
 *   "221" 賃貸・売却用及び二次的住宅を除く空き家（"真の" 閒置）
 *   "222" 賃貸用の空き家 ← 投資競争指標
 *   "223" 売却用の空き家
 *
 * 投資観点の 3 指標:
 *   totalVacancyRate   : 空家全体／総住宅（市場供需指標）
 *   trueVacancyRate    : 投資用以外の空家／総住宅（人口減トレンド反映）
 *   rentalVacancyCount : 賃貸用の空家戸数（同エリアの貸家競争状況）
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0004021421'

export interface HousingVacancy {
  areaName: string
  areaCode: string
  totalDwellings: number                // 総住宅数
  occupiedDwellings?: number             // 居住世帯あり
  vacantDwellings: number                // 空き家 合計
  nonInvestmentVacant?: number           // 賃貸・売却用・二次的住宅を除く空き家
  rentalVacant?: number                  // 賃貸用空家
  saleVacant?: number                    // 売却用空家
  totalVacancyRate: number               // % = 空家 / 総住宅 * 100
  trueVacancyRate?: number               // % = 投資用以外空家 / 総住宅 * 100
  year: number
  source: string
}

export async function getHousingVacancy(
  address: string,
): Promise<HousingVacancy | null> {
  const area = resolveArea(address)
  if (!area) return null

  const fetchFor = async (areaCode: string) => {
    const resp = await fetchStatsData(STATS_ID, { cdArea: areaCode })
    return getValues(resp)
  }

  // 市区町村 → 政令市 → 都道府県 の順でフォールバック
  const candidates = [
    { code: area.cityCode5, name: area.cityName },
    { code: area.majorCityCode5, name: area.majorCityName },
    { code: area.prefCode2 + '000', name: area.prefName },
  ]

  let values: ReturnType<typeof getValues> = []
  let used = candidates[0]
  for (const c of candidates) {
    values = await fetchFor(c.code)
    if (values.length > 0 && values.some(v => toNumber(v['$']) !== undefined)) {
      used = c
      break
    }
  }

  if (values.length === 0) return null

  const byCat: Record<string, number | undefined> = {}
  for (const v of values) {
    const k = v['@cat01']
    if (k) byCat[k] = toNumber(v['$'])
  }

  const total = byCat['0']
  const vacant = byCat['22']
  if (!total || total === 0 || vacant === undefined) return null

  return {
    areaName: used.name,
    areaCode: used.code,
    totalDwellings: total,
    occupiedDwellings: byCat['1'],
    vacantDwellings: vacant,
    nonInvestmentVacant: byCat['221'],
    rentalVacant: byCat['222'],
    saleVacant: byCat['223'],
    totalVacancyRate: (vacant / total) * 100,
    trueVacancyRate: byCat['221'] != null ? (byCat['221'] / total) * 100 : undefined,
    year: 2023,
    source: '令和5年住宅・土地統計調査',
  }
}
