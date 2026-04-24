/**
 * 在留外國人統計（市区町村 × 国籍別）— 法務省
 * ================================================
 * statsDataId: 0003147283
 *   市区町村別 国籍・地域別 在留外国人
 *
 * ⚠️ 重要：この statsDataId は **2017年6月** が最新。e-Stat では市区町村級の
 * 最新データは以降発表されていない（法務省は別媒体で継続発表）。
 * → pattern 分析用（どの區に台灣/中国人が集中するかの傾向）として使用。
 * 絶対数は陳腐化している可能性があるため、prompt で年次を明示する。
 *
 * cat01 主要国籍コード:
 *   "000" 総数
 *   "106" 台湾 ← 台灣投資者最重要
 *   "105" 中国
 *   "103" 韓国（※ "901" 韓国・朝鮮 は旧集計）
 *   "117" フィリピン
 *   "110" ベトナム
 *   "131" ネパール
 *   "304" 米国
 *   "410" ブラジル
 *
 * 投資観点:
 *   - 台灣人比率が高い區 = 台灣投資者の同国人ネットワーク、自住/賃貸両用需要
 *   - 中国/韓国人が集中 = 当該コミュニティ向け賃貸需要
 *   - 外国人総数比率 = 国際性・民泊インバウンド需要の先行指標
 */

import { fetchStatsData, getValues, toNumber } from './client'
import { resolveArea } from './areaCodeResolver'

const STATS_ID = '0003147283'
const LATEST_TIME = '2017000606' // 2017年6月、この statsDataId の最新

const NATIONALITY_CODES = {
  total: '000',
  taiwan: '106',
  china: '105',
  korea: '103',
  philippines: '117',
  vietnam: '110',
  nepal: '131',
  usa: '304',
  brazil: '410',
} as const

export interface ForeignResidents {
  areaName: string
  areaCode: string
  total: number
  taiwan?: number
  china?: number
  korea?: number
  philippines?: number
  vietnam?: number
  nepal?: number
  usa?: number
  brazil?: number
  taiwanRatio?: number  // 台湾人 / 総数
  year: number
  asOf: string          // "2017年6月"
  source: string
  dataVintage: 'pattern' // 陳腐化可能性を明示するフラグ
}

export async function getForeignResidents(
  address: string,
): Promise<ForeignResidents | null> {
  const area = resolveArea(address)
  if (!area) return null

  // 市区町村 → 政令市 → 都道府県 三段 fallback
  const candidates = [
    { code: area.cityCode5, name: area.cityName },
    { code: area.majorCityCode5, name: area.majorCityName },
    { code: area.prefCode2 + '000', name: area.prefName },
  ]

  let values: ReturnType<typeof getValues> = []
  let used = candidates[0]
  for (const c of candidates) {
    const resp = await fetchStatsData(STATS_ID, {
      cdArea: c.code,
      cdTime: LATEST_TIME,
    })
    values = getValues(resp)
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

  const total = byCat[NATIONALITY_CODES.total]
  if (!total) return null

  const taiwan = byCat[NATIONALITY_CODES.taiwan]

  return {
    areaName: used.name,
    areaCode: used.code,
    total,
    taiwan,
    china: byCat[NATIONALITY_CODES.china],
    korea: byCat[NATIONALITY_CODES.korea],
    philippines: byCat[NATIONALITY_CODES.philippines],
    vietnam: byCat[NATIONALITY_CODES.vietnam],
    nepal: byCat[NATIONALITY_CODES.nepal],
    usa: byCat[NATIONALITY_CODES.usa],
    brazil: byCat[NATIONALITY_CODES.brazil],
    taiwanRatio: taiwan != null ? taiwan / total : undefined,
    year: 2017,
    asOf: '2017年6月',
    source: '在留外国人統計（法務省、市区町村別）',
    dataVintage: 'pattern',
  }
}
