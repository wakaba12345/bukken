/**
 * 人口（令和2年国勢調査）
 * ========================
 * 市区町村別 男女別人口を取得。
 *
 * statsDataId: 0003445078
 *   総人口・総世帯数・男女・年齢・配偶関係（男女別人口）
 *   全国・都道府県・市区町村（2000年市区町村含む）
 *
 * Response の cat01:
 *   "0" = 総数
 *   "1" = 男
 *   "2" = 女
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0003445078'

export interface AreaDemographics {
  areaName: string
  cityCode: string
  population?: number
  populationMale?: number
  populationFemale?: number
  femaleRatio?: number // 0.0 - 1.0
  year: number
  source: string
}

export async function getAreaDemographics(
  address: string,
): Promise<AreaDemographics | null> {
  const area = resolveArea(address)
  if (!area) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[e-Stat/population] 未対応エリア: ${address}`)
    }
    return null
  }

  const resp = await fetchStatsData(STATS_ID, { cdArea: area.cityCode5 })
  const values = getValues(resp)
  if (values.length === 0) return null

  const findVal = (cat01: string) =>
    toNumber(values.find(v => v['@cat01'] === cat01)?.['$'])
  const total = findVal('0')
  const male = findVal('1')
  const female = findVal('2')
  if (!total) return null

  return {
    areaName: area.cityName,
    cityCode: area.cityCode5,
    population: total,
    populationMale: male,
    populationFemale: female,
    femaleRatio: female ? female / total : undefined,
    year: 2020,
    source: '令和2年国勢調査',
  }
}
