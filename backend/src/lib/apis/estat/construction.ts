/**
 * 建築着工統計調査（月次・市区町村別）
 * =====================================
 * statsDataId: 0003114535
 *   都道府県別、工事別、利用関係別／戸数・件数、床面積
 *   area は市区町村レベル（東京23区・政令市の区も個別）まで利用可能
 *
 * Response dimensions:
 *   tab   : "18" 戸数・件数 ← 使う（"13" 床面積は今回は使わない）
 *   cat01 : 利用関係 — "11"計 / "12"持家 / "13"貸家 / "14"給与住宅 / "15"分譲住宅
 *   cat02 : 工事 — "11"計 / "12"新設 ← これ / "13"その他
 *   area  : 5桁コード（13110=目黒区、13103=港区、etc）
 *   time  : "YYYY00MMMM"
 *
 * 投資観点の意味:
 *   - 貸家着工が多い = 投資家が集中、将来的な競争激化
 *   - 分譲住宅着工が多い = 新築供給多、中古物件の価格圧力
 *   - 全体着工が少ない = 成熟／衰退エリア
 *
 * 戻り値: 直近 12 ヶ月分を合計（利用関係別）
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0003114535'

export interface HousingConstruction {
  areaName: string
  areaCode: string
  totalStarts12m: number          // 新設住宅 合計戸数（直近 12 ヶ月）
  rentalStarts12m: number          // うち 貸家（投資用）
  condoStarts12m: number           // うち 分譲住宅（新築マンション等）
  owneroccupiedStarts12m: number   // うち 持家
  monthsCounted: number
  periodFrom: string
  periodTo: string
  source: string
}

function timeCode(year: number, month: number): string {
  const mm = String(month).padStart(2, '0')
  return `${year}00${mm}${mm}`
}

function timeCodeToLabel(code: string): string {
  const year = code.slice(0, 4)
  const month = parseInt(code.slice(-2), 10)
  return `${year}年${month}月`
}

export async function getHousingConstruction(
  address: string,
): Promise<HousingConstruction | null> {
  const area = resolveArea(address)
  if (!area) return null

  // 建築着工統計は 1〜2 年遅延が一般的なため、18 ヶ月分のレンジを取得して
  // 実際返ってきた最新月から 12 ヶ月を集計
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), 1)
  const start = new Date(end.getFullYear(), end.getMonth() - 23, 1)
  const timeFrom = timeCode(start.getFullYear(), start.getMonth() + 1)
  const timeTo = timeCode(end.getFullYear(), end.getMonth() + 1)

  const fetchFor = async (areaCode: string) => {
    const resp = await fetchStatsData(
      STATS_ID,
      {
        cdArea: areaCode,
        cdTab: '18',         // 戸数・件数
        cdCat02: '12',       // 新設
        cdTimeFrom: timeFrom,
        cdTimeTo: timeTo,
      },
      86400 * 7, // 7 日キャッシュ（月次データ、更新は月末）
    )
    return getValues(resp)
  }

  // 市区町村（cityCode5）→ 政令市級 → 都道府県 の順にフォールバック
  const candidates = [
    { code: area.cityCode5, name: area.cityName },
    { code: area.majorCityCode5, name: area.majorCityName },
    { code: area.prefCode2 + '000', name: area.prefName },
  ]

  let values: ReturnType<typeof getValues> = []
  let used = candidates[0]
  for (const c of candidates) {
    values = await fetchFor(c.code)
    if (values.length > 0) {
      used = c
      break
    }
  }

  if (values.length === 0) return null

  // 月ごとの最新 12 件に絞る（time 降順）
  const byMonth = new Map<string, typeof values>()
  for (const v of values) {
    const t = v['@time'] ?? ''
    if (!byMonth.has(t)) byMonth.set(t, [])
    byMonth.get(t)!.push(v)
  }
  const sortedMonths = [...byMonth.keys()].sort().reverse().slice(0, 12)
  sortedMonths.sort()

  let total = 0, rental = 0, condo = 0, owner = 0
  for (const month of sortedMonths) {
    for (const v of byMonth.get(month) ?? []) {
      const n = toNumber(v['$']) ?? 0
      switch (v['@cat01']) {
        case '11': total += n; break        // 計
        case '12': owner += n; break        // 持家
        case '13': rental += n; break       // 貸家
        case '15': condo += n; break        // 分譲住宅
        // '14' 給与住宅 は合計に含まれるが別出ししない
      }
    }
  }

  return {
    areaName: used.name,
    areaCode: used.code,
    totalStarts12m: total,
    rentalStarts12m: rental,
    condoStarts12m: condo,
    owneroccupiedStarts12m: owner,
    monthsCounted: sortedMonths.length,
    periodFrom: timeCodeToLabel(sortedMonths[0]),
    periodTo: timeCodeToLabel(sortedMonths[sortedMonths.length - 1]),
    source: '建築着工統計調査',
  }
}
