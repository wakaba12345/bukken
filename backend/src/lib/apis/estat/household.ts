/**
 * 家計調査 家計収支編（21 大都市圏級）
 * ======================================
 * statsDataId: 0002070001
 *   家計調査 家計収支編 二人以上の世帯 用途分類（総数）
 *
 * 粒度: 21 大都市圏（東京都区部 13100、大阪市 27100、横浜市 14100 等）
 *   ⚠️ 都道府県級・市区町村級データは家計調査では公開されていない
 *   （標本世帯ベースのサンプリング設計のため都道府県粒度に十分な精度なし）
 *
 * cat01 用途分類コード（実測で確認した値）:
 *   仕様書での記載は実装中の console.log dump で確認した keys を参照
 *
 * 投資観点:
 *   - 当該大都市圏の平均住居費 → 物件想定家賃の妥当性チェック
 *   - 「家計支出能力 vs 物件設定家賃」のギャップは賃貸需要の上限指標
 *   - employment.ts の affordableMonthlyRentJpy（中央値年収 × 1/3 ÷ 12）と
 *     対比可能：理論値 vs 実支出（平均値）
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0002070003' // 家計調査家計収支編 二人以上の世帯用途分類（地域別）

// 用途分類コード（家計調査家計収支編、cat01）— 実測で確認した値
// e-Stat 0002070003 sample dump で確認
const CAT_CODES = {
  consumption: '059',  // 消費支出（月額）
  housing:     '102',  // 住居費（持家＋借家平均、月額）
  rent:        '103',  // 家賃地代（借家世帯平均、月額）
} as const

export interface HouseholdSpending {
  areaName: string
  areaCode: string
  monthlyHousingExpenseJpy: number    // 住居費月額（持家＋借家平均）
  monthlyRentExpenseJpy?: number      // 家賃地代（借家世帯平均）
  monthlyConsumptionJpy?: number      // 消費支出月額（家計支出全体、参考）
  housingExpenseRatio?: number        // 住居費 / 消費支出
  year: number
  source: string
}

/**
 * 物件住所から 21 大都市圏を解決し、家計調査の住居費平均を取得。
 * 大都市圏外（地方の市町村等）は null を返す。
 */
export async function getHouseholdSpending(
  address: string,
): Promise<HouseholdSpending | null> {
  const area = resolveArea(address)
  if (!area) return null

  // 家計調査の area code は独自体系：都道府県は {prefCode2}003（例: 13003 東京都、27003 大阪府）
  // majorCityCode5（13100 等）は本 dataset では未使用
  const areaCode = area.prefCode2 + '003'
  const areaName = area.prefName

  const resp = await fetchStatsData(
    STATS_ID,
    { cdArea: areaCode },
    86400 * 30, // 月次更新だが日次変動はないので 30 日キャッシュ
  )
  const values = getValues(resp)
  if (values.length === 0) return null

  // cat01 別に集計（最新時点のみ）
  // 最新時点判定: @time が最も新しいレコード
  const latestTime = values
    .map(v => v['@time'] ?? '')
    .filter(Boolean)
    .sort()
    .pop()
  if (!latestTime) return null

  const latestValues = values.filter(v => v['@time'] === latestTime)
  const byCat01: Record<string, number | undefined> = {}
  for (const v of latestValues) {
    const k = v['@cat01']
    if (k) byCat01[k] = toNumber(v['$'])
  }

  const housing = byCat01[CAT_CODES.housing]
  if (housing == null) return null

  const rent = byCat01[CAT_CODES.rent]
  const consumption = byCat01[CAT_CODES.consumption]

  // year 抽出（time code "YYYY00..." から先頭 4 桁）
  const year = parseInt(latestTime.slice(0, 4), 10)

  return {
    areaName,
    areaCode,
    monthlyHousingExpenseJpy: housing,
    monthlyRentExpenseJpy: rent,
    monthlyConsumptionJpy: consumption,
    housingExpenseRatio:
      housing != null && consumption != null && consumption > 0
        ? housing / consumption
        : undefined,
    year: isFinite(year) ? year : 0,
    source: '家計調査 家計収支編 二人以上の世帯',
  }
}
