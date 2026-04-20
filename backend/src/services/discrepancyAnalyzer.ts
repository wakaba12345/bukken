/**
 * 落差分析エンジン
 * ================
 * 複数プラットフォームから収集した同一物件の情報を比較し、
 * 落差の種類・意味・深刻度を判定する。
 *
 * 落差の種類：
 *   PRICE_DIFF      価格差（試水溫定価の可能性）
 *   PRICE_EXCLUSIVE ある媒体にのみ掲載（独家委託）
 *   PRICE_REDUCED   価格が下がった（議価空間の可能性）
 *   AREA_DIFF       面積の不一致（登記面積 vs 壁芯面積問題）
 *   AGE_DIFF        築年数の不一致（データ登録エラー）
 *   STRUCTURE_DIFF  構造の不一致（要謄本確認）
 */

import type { Platform, PropertyData } from 'shared/types'

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export type DiscrepancyType =
  | 'PRICE_DIFF'
  | 'PRICE_EXCLUSIVE'
  | 'PRICE_REDUCED'
  | 'AREA_DIFF'
  | 'AGE_DIFF'
  | 'STRUCTURE_DIFF'
  | 'NAME_DIFF'

export type Severity = 'info' | 'caution' | 'warning'

export interface Discrepancy {
  type: DiscrepancyType
  severity: Severity
  platforms: Platform[]
  values: Record<string, string | number>   // platform → value
  interpretation: string                     // 日本語の解釈
  interpretationZh: string                   // 繁体字の解釈
  actionAdvice: string                       // 推奨アクション
}

export interface CrossPlatformAnalysis {
  /** 基準物件（ユーザーが今見ているページ） */
  source: PropertyData
  /** 他プラットフォームで見つかった同一物件 */
  matches: PlatformMatch[]
  /** 検出された落差リスト */
  discrepancies: Discrepancy[]
  /** 最安値 */
  lowestPrice: number
  lowestPlatform: Platform
  /** 価格差の合計 */
  totalPriceDiff: number
  /** 信頼スコア（0-100） */
  confidenceScore: number
  /** サマリー */
  summary: string
  summaryZh: string
}

export interface PlatformMatch {
  platform: Platform
  url: string
  price: number
  area?: number
  age?: number
  structure?: string
  name?: string
  fetchedAt: string
  priceHistory?: PriceHistoryPoint[]
}

export interface PriceHistoryPoint {
  date: string
  price: number
}

// ─── メイン分析関数 ───────────────────────────────────────────────────────────

export function analyzeCrossPlatform(
  source: PropertyData,
  matches: PlatformMatch[],
): CrossPlatformAnalysis {
  const discrepancies: Discrepancy[] = []
  const allPrices = [
    { platform: source.platform, price: source.price },
    ...matches.map(m => ({ platform: m.platform, price: m.price })),
  ]

  // ── 1. 価格差分析 ──────────────────────────────────────────────────────────
  const priceDisc = analyzePriceDiff(source, matches, allPrices)
  if (priceDisc) discrepancies.push(priceDisc)

  // ── 2. 独家委託チェック ────────────────────────────────────────────────────
  const exclusiveDisc = analyzeExclusive(source, matches)
  if (exclusiveDisc) discrepancies.push(exclusiveDisc)

  // ── 3. 価格下落チェック ────────────────────────────────────────────────────
  matches.forEach(m => {
    const reducedDisc = analyzePriceReduced(m)
    if (reducedDisc) discrepancies.push(reducedDisc)
  })

  // ── 4. 面積不一致チェック ──────────────────────────────────────────────────
  const areaDisc = analyzeAreaDiff(source, matches)
  if (areaDisc) discrepancies.push(areaDisc)

  // ── 5. 築年数不一致チェック ────────────────────────────────────────────────
  const ageDisc = analyzeAgeDiff(source, matches)
  if (ageDisc) discrepancies.push(ageDisc)

  // ── 6. 構造不一致チェック ──────────────────────────────────────────────────
  const structureDisc = analyzeStructureDiff(source, matches)
  if (structureDisc) discrepancies.push(structureDisc)

  // ── 集計 ──────────────────────────────────────────────────────────────────
  const lowestEntry = allPrices.reduce((a, b) => a.price < b.price ? a : b)
  const totalPriceDiff = source.price - lowestEntry.price

  const confidenceScore = calcConfidenceScore(matches, discrepancies)
  const { summary, summaryZh } = buildSummary(discrepancies, totalPriceDiff, lowestEntry)

  return {
    source,
    matches,
    discrepancies,
    lowestPrice: lowestEntry.price,
    lowestPlatform: lowestEntry.platform,
    totalPriceDiff,
    confidenceScore,
    summary,
    summaryZh,
  }
}

// ─── 各種落差判定 ─────────────────────────────────────────────────────────────

function analyzePriceDiff(
  source: PropertyData,
  matches: PlatformMatch[],
  allPrices: { platform: Platform; price: number }[],
): Discrepancy | null {
  if (matches.length === 0) return null

  const prices = allPrices.filter(p => p.price > 0)
  const min = Math.min(...prices.map(p => p.price))
  const max = Math.max(...prices.map(p => p.price))
  const diff = max - min
  const diffRate = diff / min

  if (diffRate < 0.005) return null // 0.5%以下は誤差

  const values: Record<string, number> = {}
  prices.forEach(p => { values[p.platform] = p.price })

  const severity: Severity =
    diffRate >= 0.05 ? 'warning' :
    diffRate >= 0.02 ? 'caution' : 'info'

  return {
    type: 'PRICE_DIFF',
    severity,
    platforms: prices.map(p => p.platform),
    values,
    interpretation: `複数プラットフォームで¥${diff.toLocaleString()}の価格差を確認。売主または仲介業者が異なる媒体で異なる価格を試している可能性があります（試水溫定価）。最安値で交渉するのが有利です。`,
    interpretationZh: `跨平台發現 ¥${diff.toLocaleString()} 的價格差。可能是賣方或仲介在不同平台試探市場反應（試水溫定價）。以最低價進行議價較為有利。`,
    actionAdvice: `${prices.find(p => p.price === min)?.platform} の価格（¥${min.toLocaleString()}）を基準に交渉してください。`,
  }
}

function analyzeExclusive(
  source: PropertyData,
  matches: PlatformMatch[],
): Discrepancy | null {
  // 主要プラットフォームに掲載されていない場合
  const MAJOR_PLATFORMS: Platform[] = ['suumo', 'athome', 'homes']
  const foundPlatforms = [source.platform, ...matches.map(m => m.platform)]
  const missingMajor = MAJOR_PLATFORMS.filter(p => !foundPlatforms.includes(p))

  if (missingMajor.length < 2) return null // 少なくとも2つの主要媒体にない場合

  return {
    type: 'PRICE_EXCLUSIVE',
    severity: 'caution',
    platforms: foundPlatforms,
    values: { missing_count: missingMajor.length },
    interpretation: `この物件は主要ポータル（${missingMajor.join('・')}）に掲載されていません。独家媒介（専任媒介）の可能性が高く、他業者を通じた交渉が難しい場合があります。`,
    interpretationZh: `此物件未在主要平台（${missingMajor.join('・')}）上架。可能是專任委託，透過其他仲介議價的空間較小。`,
    actionAdvice: '掲載元の仲介業者と直接交渉する必要があります。複数業者への同時相談は困難な場合があります。',
  }
}

function analyzePriceReduced(match: PlatformMatch): Discrepancy | null {
  if (!match.priceHistory || match.priceHistory.length < 2) return null

  const latest = match.priceHistory[match.priceHistory.length - 1].price
  const oldest = match.priceHistory[0].price
  const reduction = oldest - latest
  const reductionRate = reduction / oldest

  if (reductionRate < 0.02) return null // 2%以下は誤差

  return {
    type: 'PRICE_REDUCED',
    severity: reductionRate >= 0.05 ? 'warning' : 'caution',
    platforms: [match.platform],
    values: {
      original: oldest,
      current: latest,
      reduction,
      reduction_rate: Math.round(reductionRate * 100),
    },
    interpretation: `${match.platform}で¥${reduction.toLocaleString()}（${Math.round(reductionRate * 100)}%）の値下げを検出。売れ残りの可能性が高く、さらなる値引き交渉の余地があります。`,
    interpretationZh: `在 ${match.platform} 發現降價 ¥${reduction.toLocaleString()}（${Math.round(reductionRate * 100)}%）。滯銷可能性高，有進一步議價空間。`,
    actionAdvice: `最初の掲載価格（¥${oldest.toLocaleString()}）からの下落を示し、さらなる値引きを交渉してください。`,
  }
}

function analyzeAreaDiff(
  source: PropertyData,
  matches: PlatformMatch[],
): Discrepancy | null {
  const areas = matches
    .filter(m => m.area && m.area > 0)
    .map(m => ({ platform: m.platform, area: m.area! }))

  if (!source.area || areas.length === 0) return null

  areas.unshift({ platform: source.platform, area: source.area })

  const areaValues = areas.map(a => a.area)
  const min = Math.min(...areaValues)
  const max = Math.max(...areaValues)
  const diff = max - min

  if (diff < 1) return null // 1㎡未満は誤差

  const values: Record<string, number> = {}
  areas.forEach(a => { values[a.platform] = a.area })

  return {
    type: 'AREA_DIFF',
    severity: diff >= 3 ? 'warning' : 'caution',
    platforms: areas.map(a => a.platform),
    values,
    interpretation: `プラットフォーム間で${diff.toFixed(1)}㎡の面積差異を検出。登記面積（壁芯面積）と内法面積の違いが原因の可能性があります。謄本で登記面積を必ず確認してください。`,
    interpretationZh: `各平台之間發現 ${diff.toFixed(1)}㎡ 的面積差異。可能是登記面積（壁芯面積）與實際使用面積的差異。建議核查登記謄本。`,
    actionAdvice: '法務局の登記謄本を取得し、登記面積を公式数値で確認することを強く推奨します。',
  }
}

function analyzeAgeDiff(
  source: PropertyData,
  matches: PlatformMatch[],
): Discrepancy | null {
  const ages = matches
    .filter(m => m.age !== undefined && m.age! >= 0)
    .map(m => ({ platform: m.platform, age: m.age! }))

  if (source.age === undefined || ages.length === 0) return null

  ages.unshift({ platform: source.platform, age: source.age })

  const ageValues = ages.map(a => a.age)
  const min = Math.min(...ageValues)
  const max = Math.max(...ageValues)
  const diff = max - min

  if (diff < 1) return null

  const values: Record<string, number> = {}
  ages.forEach(a => { values[a.platform] = a.age })

  return {
    type: 'AGE_DIFF',
    severity: diff >= 3 ? 'warning' : 'caution',
    platforms: ages.map(a => a.platform),
    values,
    interpretation: `築年数に${diff}年の差異を検出。仲介業者によるデータ登録ミス、または竣工年と引渡し年の混在が考えられます。登記謄本で正確な建築年月を確認してください。`,
    interpretationZh: `發現築年數有 ${diff} 年的差異。可能是資料登錄錯誤，或竣工年與交屋年混用。請核查登記謄本確認正確建築年月。`,
    actionAdvice: '建築確認済証や登記謄本で正確な建築年月を確認。古い場合は耐震基準（1981年・2000年）も要チェック。',
  }
}

function analyzeStructureDiff(
  source: PropertyData,
  matches: PlatformMatch[],
): Discrepancy | null {
  // TODO: source.structure が実装されたら有効化
  return null
}

// ─── スコア・サマリー ─────────────────────────────────────────────────────────

function calcConfidenceScore(
  matches: PlatformMatch[],
  discrepancies: Discrepancy[],
): number {
  let score = 50
  score += matches.length * 15        // 比較元が多いほど高信頼
  score -= discrepancies.filter(d => d.severity === 'warning').length * 20
  score -= discrepancies.filter(d => d.severity === 'caution').length * 8
  return Math.max(0, Math.min(100, score))
}

function buildSummary(
  discrepancies: Discrepancy[],
  totalPriceDiff: number,
  lowestEntry: { platform: Platform; price: number },
): { summary: string; summaryZh: string } {
  if (discrepancies.length === 0) {
    return {
      summary: 'プラットフォーム間の情報に大きな差異は見つかりませんでした。',
      summaryZh: '各平台之間未發現重大差異。',
    }
  }

  const warningCount = discrepancies.filter(d => d.severity === 'warning').length
  const hasPriceDiff = discrepancies.some(d => d.type === 'PRICE_DIFF')
  const hasAreaDiff = discrepancies.some(d => d.type === 'AREA_DIFF')
  const hasAgeDiff = discrepancies.some(d => d.type === 'AGE_DIFF')

  let summary = `${discrepancies.length}件の情報落差を検出。`
  let summaryZh = `發現 ${discrepancies.length} 項資訊落差。`

  if (hasPriceDiff && totalPriceDiff > 0) {
    summary += `${lowestEntry.platform}が最安値（¥${totalPriceDiff.toLocaleString()}差）。`
    summaryZh += `${lowestEntry.platform} 為最低價（差 ¥${totalPriceDiff.toLocaleString()}）。`
  }
  if (hasAreaDiff) {
    summary += '面積データの不一致あり（謄本確認推奨）。'
    summaryZh += '面積數據不一致（建議核查謄本）。'
  }
  if (hasAgeDiff) {
    summary += '築年数データの不一致あり。'
    summaryZh += '築年數數據不一致。'
  }
  if (warningCount > 0) {
    summary += `要注意事項${warningCount}件。`
    summaryZh += `需注意事項 ${warningCount} 件。`
  }

  return { summary, summaryZh }
}
