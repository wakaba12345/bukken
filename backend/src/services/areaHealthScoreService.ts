/**
 * AreaHealthScoreService — 多源 e-Stat 集計 → 地域健康度スコア
 * ================================================================
 * 6 つの e-Stat 指標（人口/人口移動/建築着工/空屋/在留外國人/就業所得）を
 * 一つの `{score, grade, trend, insights, riskFlags}` に集約する。
 *
 * **設計原則**
 * - データ欠損時は重みを再正規化（欠損項目は 0 点としない）
 * - 各指標の閾値は全国平均（空屋率 13.8%、所得中央値 ¥350 万等）基準
 * - popMove は都市級データ（21大都市）で粒度が大きいため、絶対値で評価
 * - 他の指標は市区町村粒度なので ratio 計算可能
 *
 * Phase 1.6 現段階では prompt に注入しない（raw 資料そのまま prompt へ）。
 * extension UI / 報告 header / 搜尋排序用途を想定した side feature。
 */

import type {
  AreaDemographics,
  PopulationMovement,
  HousingConstruction,
  HousingVacancy,
  ForeignResidents,
  EmploymentIncome,
} from '../lib/apis/estat'
import type { AreaHealthScore, AreaHealthGrade, AreaTrend } from 'shared/types'

interface Inputs {
  demographics?: AreaDemographics
  popMove?: PopulationMovement
  construction?: HousingConstruction
  vacancy?: HousingVacancy
  foreignRes?: ForeignResidents
  employment?: EmploymentIncome
}

// ─── 個別指標 → 0-100 点 ────────────────────────────────────────────────────

function scorePopMove(popMove?: PopulationMovement): number | null {
  if (!popMove) return null
  const n = popMove.netMigration12m
  // popMove は 21大都市粒度で絶対値が大きい（例: 東京特別区部 +38,149）
  // 市区町村粒度との ratio 計算は粒度不一致のため使わない
  if (n > 20_000) return 95
  if (n > 10_000) return 88
  if (n > 3_000) return 78
  if (n > 500) return 65
  if (n > 0) return 55
  if (n > -1_000) return 42
  if (n > -5_000) return 28
  return 12
}

function scorePopulation(demo?: AreaDemographics): number | null {
  const p = demo?.population
  if (p == null) return null
  if (p > 500_000) return 85
  if (p > 200_000) return 75
  if (p > 100_000) return 65
  if (p > 50_000) return 55
  if (p > 20_000) return 45
  return 30
}

function scoreForeignResidents(fr?: ForeignResidents, popSize?: number): number | null {
  if (!fr) return null
  // fr.areaName と demographics の area が一致すれば ratio 計算可能
  // 不一致でも ratio を使わず絶対数ベースで評価
  const sameArea = fr.areaName && popSize != null
  if (sameArea && popSize) {
    const ratio = (fr.total / popSize) * 100
    if (ratio > 6) return 88
    if (ratio > 3) return 75
    if (ratio > 1.5) return 60
    if (ratio > 0.5) return 45
    return 35
  }
  if (fr.total > 10_000) return 75
  if (fr.total > 5_000) return 65
  if (fr.total > 1_000) return 50
  return 40
}

function scoreVacancy(vac?: HousingVacancy): number | null {
  if (!vac) return null
  // 全国平均 総空屋率 13.8%、真空屋率 ~4-5%
  const total = vac.totalVacancyRate
  const trueR = vac.trueVacancyRate

  let totalScore: number
  if (total < 8) totalScore = 95
  else if (total < 10) totalScore = 85
  else if (total < 13.8) totalScore = 70
  else if (total < 16) totalScore = 50
  else if (total < 20) totalScore = 30
  else totalScore = 10

  if (trueR == null) return totalScore
  let trueScore: number
  if (trueR < 2) trueScore = 95
  else if (trueR < 3) trueScore = 85
  else if (trueR < 5) trueScore = 65
  else if (trueR < 7) trueScore = 40
  else trueScore = 15

  return Math.round((totalScore + trueScore) / 2)
}

function scoreConstruction(ct?: HousingConstruction, totalDwellings?: number): number | null {
  if (!ct) return null
  // 貸家着工率 = rentalStarts12m / totalDwellings → 供給過熱度を評価
  // 高着工 = 競争激化 → 投資観点では低評価
  if (totalDwellings && totalDwellings > 0) {
    const rate = (ct.rentalStarts12m / totalDwellings) * 100
    if (rate < 0.3) return 80
    if (rate < 0.7) return 65
    if (rate < 1.2) return 50
    if (rate < 2.0) return 35
    return 20
  }
  if (ct.rentalStarts12m < 100) return 70
  if (ct.rentalStarts12m < 500) return 55
  if (ct.rentalStarts12m < 1_500) return 45
  return 30
}

function scoreEmployment(emp?: EmploymentIncome): number | null {
  if (!emp) return null
  const high10m = emp.above1000mRatio * 100
  if (high10m > 15) return 95
  if (high10m > 10) return 85
  if (high10m > 6) return 70
  if (high10m > 3) return 55
  if (high10m > 1.5) return 40
  return 25
}

// ─── メイン ────────────────────────────────────────────────────────────────

export function computeAreaHealthScore(inputs: Inputs): AreaHealthScore | null {
  const { demographics, popMove, construction, vacancy, foreignRes, employment } = inputs
  const popSize = demographics?.population
  const totalDwellings = vacancy?.totalDwellings

  const scores = {
    popMove: scorePopMove(popMove),
    population: scorePopulation(demographics),
    foreign: scoreForeignResidents(foreignRes, popSize),
    vacancy: scoreVacancy(vacancy),
    construction: scoreConstruction(construction, totalDwellings),
    employment: scoreEmployment(employment),
  }

  const hasAnyData = Object.values(scores).some(s => s != null)
  if (!hasAnyData) return null

  // 重み（欠損時は再正規化）
  const weights = {
    popMove: 0.20,
    population: 0.10,
    foreign: 0.10,
    vacancy: 0.25,
    construction: 0.15,
    employment: 0.20,
  } as const

  let weightSum = 0
  let weightedSum = 0
  for (const [key, weight] of Object.entries(weights)) {
    const s = scores[key as keyof typeof scores]
    if (s != null) {
      weightSum += weight
      weightedSum += s * weight
    }
  }
  const overallScore = Math.round(weightedSum / weightSum)
  const dataCompleteness = Math.round(weightSum * 100) / 100

  // サブスコア（カテゴリ内で再正規化）
  const calcSub = (items: Array<[keyof typeof scores, number]>): number => {
    let sum = 0
    let wSum = 0
    for (const [key, w] of items) {
      const s = scores[key]
      if (s != null) {
        sum += s * w
        wSum += w
      }
    }
    return wSum > 0 ? Math.round(sum / wSum) : 0
  }

  const subScores = {
    demand: calcSub([['popMove', 0.5], ['population', 0.25], ['foreign', 0.25]]),
    supply: calcSub([['vacancy', 0.65], ['construction', 0.35]]),
    purchasingPower: scores.employment ?? 0,
  }

  const grade: AreaHealthGrade =
    overallScore >= 85 ? 'A' :
    overallScore >= 70 ? 'B' :
    overallScore >= 55 ? 'C' :
    overallScore >= 40 ? 'D' : 'F'

  // Trend: popMove が main signal、なければ空屋+着工で proxy
  let trend: AreaTrend = 'stable'
  if (popMove) {
    if (popMove.netMigration12m > 5_000) trend = 'rising'
    else if (popMove.netMigration12m > 0) trend = 'stable'
    else trend = 'declining'
  } else if (vacancy && construction) {
    if (vacancy.totalVacancyRate < 10 && construction.totalStarts12m > 500) trend = 'rising'
    else if (vacancy.totalVacancyRate > 18) trend = 'declining'
  }

  // Key insights（高分項目から抽出）— 各指標の `areaName` を prefix して粒度を明示
  // （popMove / employment は 21大都市級、vacancy / construction / demographics は市区町村級。
  //  混在を避けるため、使用者が「どのスコープの数字か」を一目で判断できるようにする）
  const keyInsights: string[] = []
  if ((scores.popMove ?? 0) >= 75 && popMove) {
    keyInsights.push(
      `人口流入強（${popMove.areaName} ${popMove.netMigration12m > 0 ? '+' : ''}${popMove.netMigration12m.toLocaleString()}人 / ${popMove.monthsCounted}ヶ月）`,
    )
  }
  if ((scores.vacancy ?? 0) >= 75 && vacancy) {
    keyInsights.push(
      `空屋率健全（${vacancy.areaName} 総${vacancy.totalVacancyRate.toFixed(1)}%、全国平均 13.8% 以下）`,
    )
  }
  if ((scores.employment ?? 0) >= 75 && employment) {
    keyInsights.push(
      `高所得層厚（${employment.areaName} 年収 ¥10M 以上 ${(employment.above1000mRatio * 100).toFixed(1)}%）`,
    )
  }
  if ((scores.foreign ?? 0) >= 65 && foreignRes?.taiwanRatio != null && foreignRes.taiwanRatio > 0.03) {
    keyInsights.push(
      `台湾人コミュニティ集積（${foreignRes.areaName} ${(foreignRes.taiwanRatio * 100).toFixed(1)}%、${foreignRes.asOf}時点）`,
    )
  }
  if ((scores.population ?? 0) >= 75 && demographics) {
    keyInsights.push(
      `人口規模大（${demographics.areaName} ${demographics.population?.toLocaleString()}人）`,
    )
  }
  if ((scores.construction ?? 0) >= 65 && construction) {
    keyInsights.push(
      `新規供給適度（${construction.areaName} 貸家 ${construction.rentalStarts12m.toLocaleString()}戸 / ${construction.monthsCounted}ヶ月）`,
    )
  }

  // Risk flags（低分項目から抽出）
  const riskFlags: string[] = []
  if ((scores.popMove ?? 100) <= 42 && popMove) {
    riskFlags.push(
      `人口流出（${popMove.areaName} ${popMove.netMigration12m.toLocaleString()}人 / ${popMove.monthsCounted}ヶ月）`,
    )
  }
  if ((scores.vacancy ?? 100) <= 50 && vacancy) {
    riskFlags.push(
      `空屋率高水準（${vacancy.areaName} 総${vacancy.totalVacancyRate.toFixed(1)}%、全国平均超過）`,
    )
  }
  if (vacancy?.trueVacancyRate != null && vacancy.trueVacancyRate > 5) {
    riskFlags.push(
      `真空屋率 ${vacancy.areaName} ${vacancy.trueVacancyRate.toFixed(1)}%（長期人口減圧力）`,
    )
  }
  if ((scores.construction ?? 100) <= 35 && construction) {
    riskFlags.push(
      `貸家新規着工多（${construction.areaName} ${construction.rentalStarts12m.toLocaleString()}戸 / ${construction.monthsCounted}ヶ月、供給競争リスク）`,
    )
  }
  if ((scores.employment ?? 100) <= 40 && employment) {
    riskFlags.push(
      `高所得層薄（${employment.areaName} ≥¥10M 割合 ${(employment.above1000mRatio * 100).toFixed(1)}%、購買力限定的）`,
    )
  }

  return {
    areaName: demographics?.areaName ?? popMove?.areaName ?? vacancy?.areaName ?? '地域不明',
    overallScore,
    grade,
    trend,
    subScores,
    keyInsights,
    riskFlags,
    dataCompleteness,
  }
}
