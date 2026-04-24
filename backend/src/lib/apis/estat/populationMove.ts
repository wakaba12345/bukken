/**
 * 住民基本台帳 人口移動報告（月次・転入超過数）
 * ===============================================
 * statsDataId: 0003420473
 *   男女別都道府県内移動者数，他都道府県からの転入者数及び他都道府県への転出者数
 *   全国／都道府県／3大都市圏／21大都市、2005年4月〜最新月（通常2〜3ヶ月遅れ）
 *
 * Response dimensions:
 *   tab  : "01"都道府県内、"02"転入、"03"転出、"04"転入超過数 ← これを使う
 *   cat01: "0"総数、"1"男、"2"女
 *   cat02: "60000"移動者、"61000"日本人、"62000"外国人
 *   area : "00000"全国、"XX000"都道府県、21大都市コード
 *   time : "YYYY00MMMM"（例: 2026年3月 = "2026000303"）
 *
 * 戻り値: 直近 12 ヶ月の転入超過合計。投資判断としては月次変動より
 * 年累計のほうが安定指標になる。
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0003420473'

export interface PopulationMovement {
  areaName: string
  areaCode: string                // 実使用 area code（majorCityCode5 または prefCode+000）
  netMigration12m: number          // 直近 12 ヶ月 転入超過数合計（+ = 流入、- = 流出）
  monthsCounted: number            // 実際にデータが返ってきた月数
  latestMonth: string              // "2026年3月"
  periodFrom: string               // "2025年4月"
  periodTo: string                 // "2026年3月"
  source: string
}

/**
 * YYYY年M月 → e-Stat の time code "YYYY00MMMM"
 */
function timeCode(year: number, month: number): string {
  const mm = String(month).padStart(2, '0')
  return `${year}00${mm}${mm}`
}

/**
 * time code "2026000303" → 表示用 "2026年3月"
 */
function timeCodeToLabel(code: string): string {
  const year = code.slice(0, 4)
  const month = parseInt(code.slice(-2), 10)
  return `${year}年${month}月`
}

/**
 * 直近 12 ヶ月の転入超過を集計
 * 優先順位: majorCityCode5 → prefCode2+"000"（都道府県）
 */
export async function getPopulationMovement(
  address: string,
): Promise<PopulationMovement | null> {
  const area = resolveArea(address)
  if (!area) return null

  // 12ヶ月のレンジを動的生成（e-Stat は通常 1〜2 ヶ月遅延なので end = 今月 - 2）
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth() - 2, 1)
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1)
  const timeFrom = timeCode(start.getFullYear(), start.getMonth() + 1)
  const timeTo = timeCode(end.getFullYear(), end.getMonth() + 1)

  const fetchFor = async (areaCode: string) => {
    const resp = await fetchStatsData(
      STATS_ID,
      {
        cdArea: areaCode,
        cdTab: '04',         // 転入超過数
        cdCat01: '0',        // 総数
        cdCat02: '60000',    // 全移動者（日本人＋外国人）
        cdTimeFrom: timeFrom,
        cdTimeTo: timeTo,
      },
      86400, // 1 日キャッシュ（月次更新なので毎日確認で十分）
    )
    return getValues(resp)
  }

  // 最細粒度（21大都市）を試す
  let values = await fetchFor(area.majorCityCode5)
  let used = area.majorCityCode5
  let usedName = area.majorCityName

  // 対応外なら都道府県にフォールバック
  if (values.length === 0) {
    const prefAreaCode = area.prefCode2 + '000'
    values = await fetchFor(prefAreaCode)
    used = prefAreaCode
    usedName = area.prefName
  }

  if (values.length === 0) return null

  const net = values.reduce((sum, v) => sum + (toNumber(v['$']) ?? 0), 0)

  // time は逆順（最新が先頭）で返ってくる
  const sortedTimes = values
    .map(v => v['@time'] ?? '')
    .filter(Boolean)
    .sort()
  const periodFromCode = sortedTimes[0]
  const periodToCode = sortedTimes[sortedTimes.length - 1]

  return {
    areaName: usedName,
    areaCode: used,
    netMigration12m: Math.round(net),
    monthsCounted: values.length,
    latestMonth: timeCodeToLabel(periodToCode),
    periodFrom: timeCodeToLabel(periodFromCode),
    periodTo: timeCodeToLabel(periodToCode),
    source: '住民基本台帳人口移動報告',
  }
}
