import Anthropic from '@anthropic-ai/sdk'
import type {
  PropertyData,
  FeatureKey,
  ReportContent,
  DisasterRisk,
  AreaMarket,
  ZoningInfo,
  OfficialLandPrice,
} from 'shared/types'
import { geocode } from '../lib/apis/geocode'
import { getEarthquakeRisk } from '../lib/apis/jshis'
import { getDisasterRisk, getZoning, getOfficialLandPrice } from '../lib/apis/reinfolib'
import { getAreaMarket } from '../lib/apis/fudosandb'
import { getNearbyTransactions, type AreaTransactionResult } from '../lib/apis/landprice'
import { getElevation, describeFloodRiskByElevation, type ElevationResult } from '../lib/apis/elevation'
import {
  getAreaDemographics, type AreaDemographics,
  getPopulationMovement, type PopulationMovement,
  getHousingConstruction, type HousingConstruction,
  getHousingVacancy, type HousingVacancy,
  getForeignResidents, type ForeignResidents,
  getEmploymentIncome, type EmploymentIncome,
} from '../lib/apis/estat'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // 529 overload・429 rate limit の一時的な失敗に耐える（SDK の default は 2）
  // 指数バックオフ: 2s → 4s → 8s → 16s → 32s、合計最大 ~60s
  maxRetries: 5,
})

export async function generateReport(
  property: PropertyData,
  type: FeatureKey,
): Promise<ReportContent> {

  // ── 座標取得 ──────────────────────────────────────────────────────────────
  let lat = property.lat
  let lng = property.lng
  if (!lat || !lng) {
    const coords = await geocode(property.address)
    lat = coords?.lat
    lng = coords?.lng
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[reportService] geocode result: lat=${lat}, lng=${lng} for "${property.address}"`)
  }

  const isDeep = type === 'deep_report'

  // ── 並列でデータ取得 ────────────────────────────────────────────────────
  const [disasterRisk, areaMarket, landTransactions, zoningRes, landPriceRes, elevationRes, demographicsRes, popMoveRes, constructionRes, vacancyRes, foreignResRes, employmentRes] = await Promise.allSettled([
    lat && lng ? fetchDisasterRisk(lat, lng) : Promise.resolve(undefined),
    lat && lng ? getAreaMarket(property.address, lat, lng) : Promise.resolve(undefined),
    getNearbyTransactions(property.address),
    isDeep && lat && lng ? getZoning(lat, lng) : Promise.resolve(null),
    isDeep && lat && lng ? getOfficialLandPrice(lat, lng) : Promise.resolve(null),
    lat && lng ? getElevation(lat, lng) : Promise.resolve(null),
    getAreaDemographics(property.address),
    getPopulationMovement(property.address),
    getHousingConstruction(property.address),
    getHousingVacancy(property.address),
    getForeignResidents(property.address),
    getEmploymentIncome(property.address),
  ])

  const disaster     = disasterRisk.status === 'fulfilled'     ? disasterRisk.value     : undefined
  const market       = areaMarket.status === 'fulfilled'       ? (areaMarket.value ?? undefined) : undefined
  const transactions = landTransactions.status === 'fulfilled' ? landTransactions.value : undefined
  const zoning       = zoningRes.status === 'fulfilled'        ? (zoningRes.value ?? undefined)    : undefined
  const landPrice    = landPriceRes.status === 'fulfilled'     ? (landPriceRes.value ?? undefined) : undefined
  const elevation    = elevationRes.status === 'fulfilled'     ? (elevationRes.value ?? undefined) : undefined
  const demographics = demographicsRes.status === 'fulfilled'  ? (demographicsRes.value ?? undefined) : undefined
  const popMove      = popMoveRes.status === 'fulfilled'       ? (popMoveRes.value ?? undefined) : undefined
  const construction = constructionRes.status === 'fulfilled'  ? (constructionRes.value ?? undefined) : undefined
  const vacancy      = vacancyRes.status === 'fulfilled'       ? (vacancyRes.value ?? undefined) : undefined
  const foreignRes   = foreignResRes.status === 'fulfilled'    ? (foreignResRes.value ?? undefined) : undefined
  const employment   = employmentRes.status === 'fulfilled'    ? (employmentRes.value ?? undefined) : undefined

  // ── Claude API でレポート生成 ────────────────────────────────────────────
  const aiAnalysis = await generateAiAnalysis(property, type, disaster, market, transactions, zoning, landPrice, elevation, demographics, popMove, construction, vacancy, foreignRes, employment)

  // 成約データを areaMarket のフォールバックとして使用
  const mergedMarket: AreaMarket | undefined = market ?? (transactions && transactions.count > 0 ? {
    avgPricePerSqm:     transactions.avgPricePerSqm,
    recentTransactions: transactions.count,
    priceChange6m:      0,
  } : undefined)

  return {
    type: type === 'quick_summary' ? 'quick_summary'
        : type === 'deep_report'   ? 'deep'
        : 'standard',
    property: { ...property, lat, lng },
    disasterRisk: disaster,
    areaMarket: mergedMarket,
    zoning,
    officialLandPrice: landPrice,
    aiAnalysis,
    generatedAt: new Date().toISOString(),
    pointsUsed: 0, // caller sets this
  }
}

async function fetchDisasterRisk(lat: number, lng: number): Promise<DisasterRisk> {
  const [earthquake, reinfoDisaster] = await Promise.allSettled([
    getEarthquakeRisk(lat, lng),
    getDisasterRisk(lat, lng),
  ])

  const eq = earthquake.status === 'fulfilled' ? earthquake.value : null
  const rd = reinfoDisaster.status === 'fulfilled' ? reinfoDisaster.value : null
  const anyApiOk = eq != null || rd != null

  // リスクスコア算出 (0-100, 100=最安全)。全 API 失敗時は undefined
  // （score=100 を返すと AI が "最安全" と誤読する — Rule #4 違反）
  let score = 100
  if (eq?.prob30yr6Strong) score -= eq.prob30yr6Strong * 40
  if (rd?.floodRisk === 'high')      score -= 20
  if (rd?.floodRisk === 'very_high') score -= 30
  if (rd?.landslideRisk === 'high')  score -= 15

  return {
    earthquake30yr: eq?.prob30yr6Strong,
    floodRisk: rd?.floodRisk ?? 'none',
    landslideRisk: rd?.landslideRisk ?? 'none',
    tsunamiRisk: rd?.tsunamiRisk ?? 'none',
    overallScore: anyApiOk ? Math.max(0, Math.round(score)) : undefined,
  }
}

async function generateAiAnalysis(
  property: PropertyData,
  type: FeatureKey,
  disaster?: DisasterRisk,
  market?: AreaMarket,
  transactions?: AreaTransactionResult | null,
  zoning?: ZoningInfo,
  landPrice?: OfficialLandPrice,
  elevation?: ElevationResult,
  demographics?: AreaDemographics,
  popMove?: PopulationMovement,
  construction?: HousingConstruction,
  vacancy?: HousingVacancy,
  foreignRes?: ForeignResidents,
  employment?: EmploymentIncome,
) {
  const isQuick = type === 'quick_summary'
  const isDeep  = type === 'deep_report'

  const systemPrompt = `You are a Japanese real estate analyst. Analyze properties for investors, primarily from Taiwan and Japan.
Always respond in ${isDeep ? 'detailed' : 'concise'} format.
Focus on investment potential, risk factors, and actionable insights.
Output must be valid JSON only, no markdown.

CRITICAL DATA INTEGRITY RULES (violations are serious errors):
1. You MUST only cite numbers that appear VERBATIM in the "Property data" / "Area market data" / "Disaster risk" sections below. Copy them character-for-character.
2. NEVER estimate, round, infer, or fabricate numbers (price per ㎡, yield, rent, area, management fee, age, etc.) that are not explicitly given.
3. If a field is "N/A", "Unknown", or missing, you MUST say "データなし / 資料未提供" in Japanese/Chinese. Do NOT guess.
4. For disaster risks, the value "none" means "DATA UNAVAILABLE" (the API call failed or no API key), NOT "zero risk". Treat "none" as unknown and explicitly state the data is unavailable. Never claim a property is "safe" or "low risk" based on a "none" value.
5. If multiple pros/cons require numbers you don't have, write fewer pros/cons rather than inventing values.`

  const userPrompt = `Analyze this property and return JSON with this exact structure:
{
  "summary": "2-3 sentence overview",
  "pros": [...],
  "cons": [...],
  "recommendation": "1-2 sentence actionable advice",
  "investmentScore": 75
}

Guidance for pros/cons: list every material signal the data sections below support — do NOT cap at a fixed count. Each data section (market, demographics, migration, construction, international community, purchasing power, disaster, elevation, zoning, land price, transactions) may contribute one or more pros/cons when meaningful. Quality over fluff, but never omit a significant finding just because you already have "enough" entries. Rule 5 still applies — no fabrication when data is missing.

Property data (use these numbers VERBATIM — do not modify):
- Address: ${property.address}
- Price: ¥${property.price.toLocaleString()}
- Area: ${property.area}㎡
- Age: ${property.age ? `${property.age}年` : 'Unknown'}
- Platform: ${property.platform}
- Transport: ${property.transport?.join(', ') || 'N/A'}
- Management fee: ${property.managementFee ? `¥${property.managementFee.toLocaleString()}/月` : 'N/A'}

${market ? `Area market data:
- Avg price/㎡: ¥${market.avgPricePerSqm.toLocaleString()}
- Estimated rent: ${market.estimatedRent ? `¥${market.estimatedRent.toLocaleString()}/月` : 'N/A'}
- Estimated yield: ${market.estimatedYield ? `${market.estimatedYield.toFixed(1)}%` : 'N/A'}
- Price change 6m: ${market.priceChange6m > 0 ? '+' : ''}${market.priceChange6m.toFixed(1)}%` : ''}

${disaster ? `Disaster risk:
${disaster.earthquake30yr != null
  ? `- Earthquake (30yr 震度6強 probability): ${(disaster.earthquake30yr * 100).toFixed(1)}%`
  : `- Earthquake (30yr 震度6強): データなし（J-SHIS API 取得失敗 — リスク不明、"ゼロ" と解釈してはならない）`}
- Flood risk: ${disaster.floodRisk}
${disaster.overallScore != null
  ? `- Overall safety score: ${disaster.overallScore}/100`
  : `- Overall safety score: データなし（全ハザード API 失敗のため計算不可）`}` : ''}

${elevation ? `Elevation (国土地理院):
- Altitude: ${elevation.meters.toFixed(1)}m above sea level
- Qualitative assessment: ${describeFloodRiskByElevation(elevation.meters)}
- Data source: ${elevation.source}` : ''}

${demographics ? `Area demographics (e-Stat ${demographics.source}, ${demographics.year}):
- Area: ${demographics.areaName}
- Total population: ${demographics.population?.toLocaleString() ?? 'N/A'}
${demographics.populationMale ? `- Male population: ${demographics.populationMale.toLocaleString()}` : ''}
${demographics.populationFemale ? `- Female population: ${demographics.populationFemale.toLocaleString()}` : ''}
${demographics.femaleRatio != null ? `- Female ratio: ${(demographics.femaleRatio * 100).toFixed(1)}%` : ''}
(Note: reference these area demographics in your analysis — they indicate rental demand and resident composition for the area.)` : ''}

${popMove ? `Population migration trend (e-Stat ${popMove.source}, last ${popMove.monthsCounted} months ending ${popMove.latestMonth}):
- Area: ${popMove.areaName}
- Net migration (${popMove.periodFrom} – ${popMove.periodTo}): ${popMove.netMigration12m > 0 ? '+' : ''}${popMove.netMigration12m.toLocaleString()} people
- Interpretation: ${popMove.netMigration12m > 5000 ? 'strong inflow (rising area, rental demand expanding)' : popMove.netMigration12m > 0 ? 'net inflow (stable/growing area)' : popMove.netMigration12m > -1000 ? 'roughly flat' : 'net outflow (area shrinking, rental demand at risk)'}
(Note: this is the most immediate signal of whether rental demand is rising or falling. Reference it prominently.)` : ''}

${construction ? `New housing construction (e-Stat ${construction.source}, ${construction.periodFrom} – ${construction.periodTo}):
- Area: ${construction.areaName}
- Total new starts (last ${construction.monthsCounted} months): ${construction.totalStarts12m.toLocaleString()} units
- Rental units (貸家): ${construction.rentalStarts12m.toLocaleString()} (${construction.totalStarts12m > 0 ? ((construction.rentalStarts12m / construction.totalStarts12m) * 100).toFixed(0) : 0}% of total)
- Condo units (分譲): ${construction.condoStarts12m.toLocaleString()}
- Owner-occupied (持家): ${construction.owneroccupiedStarts12m.toLocaleString()}
(Note: interpretation for investor — high 貸家 starts signal competition ahead; high 分譲 signals new-build supply pressure on resale prices; low total suggests a mature/saturated or declining area.)` : ''}

${vacancy ? `Housing vacancy stock (e-Stat ${vacancy.source}, ${vacancy.year}):
- Area: ${vacancy.areaName}
- Total dwellings: ${vacancy.totalDwellings.toLocaleString()}
- Vacant dwellings: ${vacancy.vacantDwellings.toLocaleString()} (total vacancy rate: ${vacancy.totalVacancyRate.toFixed(1)}%)
${vacancy.trueVacancyRate != null ? `- True vacancy rate (excl. rental/sale/secondary-use — reflects underlying population decline): ${vacancy.trueVacancyRate.toFixed(1)}%` : ''}
${vacancy.rentalVacant != null ? `- Rental units currently vacant (direct competition signal): ${vacancy.rentalVacant.toLocaleString()}` : ''}
(Note: Japan national total vacancy rate average is ~13.8% (2023). Total vacancy >15% signals oversupply / demand weakness; true vacancy >5% signals long-term population decline pressure on the area. Rental vacancy count should be weighed vs new 貸家 construction above — both together describe rental competition. ALWAYS include totalVacancyRate in pros/cons framing; if totalVacancyRate >15% or trueVacancyRate >5%, flag it explicitly as a con.)` : ''}

${foreignRes ? `International community presence (法務省 ${foreignRes.source}, as of ${foreignRes.asOf} — vintage data, pattern-use only):
- Area: ${foreignRes.areaName}
- Total foreign residents: ${foreignRes.total.toLocaleString()}
${foreignRes.taiwan != null ? `- Taiwanese residents: ${foreignRes.taiwan.toLocaleString()}${foreignRes.taiwanRatio != null ? ` (${(foreignRes.taiwanRatio * 100).toFixed(2)}% of all foreign residents)` : ''}` : ''}
${foreignRes.china != null ? `- Chinese residents: ${foreignRes.china.toLocaleString()}` : ''}
${foreignRes.korea != null ? `- Korean residents: ${foreignRes.korea.toLocaleString()}` : ''}
${foreignRes.vietnam != null ? `- Vietnamese residents: ${foreignRes.vietnam.toLocaleString()}` : ''}
(Note: This data is ${foreignRes.asOf} — absolute numbers are outdated. Use ONLY as a PATTERN indicator, e.g. "this area historically has a strong Taiwanese community," not as a current figure. For Taiwanese investors specifically, high Taiwanese ratio signals: existing cultural network, easier self-use, stable Taiwanese tenant demand. Always qualify such statements with the data year. If Taiwanese ratio ≥3%, or any single nationality exceeds 20% of foreign residents, include it as a pro/con explicitly.)` : ''}

${employment ? `Income & purchasing power (総務省 ${employment.source}):
- Area: ${employment.areaName}
- Workers surveyed: ${employment.totalWorkers.toLocaleString()}
- Share earning ≥¥5M/year: ${(employment.above500mRatio * 100).toFixed(1)}%
- Share earning ≥¥7M/year: ${(employment.above700mRatio * 100).toFixed(1)}%
- Share earning ≥¥10M/year: ${(employment.above1000mRatio * 100).toFixed(1)}%
- Estimated median income: ¥${(employment.medianIncomeMan * 10000).toLocaleString()}/year
- Affordable monthly rent ceiling (median income × 1/3 ÷ 12): ¥${employment.affordableMonthlyRentJpy.toLocaleString()}
(Note: ALWAYS cite median income and affordable rent ceiling to frame the area's tenant / buyer profile — even if market.estimatedRent is missing. Compare affordableMonthlyRentJpy vs property's estimatedRent when available; if property rent significantly exceeds the local 1/3-income ceiling, rental demand is weak. Also compare property price vs median income to judge whether the target tenant/buyer segment matches. High ≥¥10M share = market suitable for premium properties; low share = volume/value segment.)` : ''}

${transactions && transactions.count > 0 ? `
Nearby actual transaction prices (国土交通省 成約データ, last 2 years):
- Transactions found: ${transactions.count}件
- Avg price/㎡: ¥${transactions.avgPricePerSqm.toLocaleString()}
- Median transaction price: ¥${transactions.medianPrice.toLocaleString()}
- Sample transactions:
${transactions.transactions.slice(0, 5).map(t =>
  `  • ¥${t.price.toLocaleString()} / ${t.area}㎡ (¥${t.pricePerSqm.toLocaleString()}/㎡)${t.floorPlan ? ` ${t.floorPlan}` : ''}${t.buildingYear ? ` 築${new Date().getFullYear() - t.buildingYear}年` : ''} ${t.period}`
).join('\n')}` : ''}

${isDeep && zoning ? `Zoning (用途地域):
- Category: ${zoning.category}
- Building coverage ratio (建蔽率): ${zoning.buildingCoverageRatio ?? 'N/A'}%
- Floor area ratio (容積率): ${zoning.floorAreaRatio ?? 'N/A'}%
- Fire zone: ${zoning.fireZone ?? 'none'}` : ''}

${isDeep && landPrice ? `Official land price (公示地価 reference point within ${landPrice.distanceToSiteM}m):
- Price/㎡: ¥${landPrice.pricePerSqm.toLocaleString()} (${landPrice.year})
- Use category: ${landPrice.useCategory}${landPrice.nearestStation ? `\n- Nearest station: ${landPrice.nearestStation}${landPrice.distanceToStationM ? ` (${landPrice.distanceToStationM}m)` : ''}` : ''}

Compare the property price/㎡ against this official reference. Note any significant premium or discount.` : ''}

${isQuick ? 'Be very concise. Max 100 words for summary.' : ''}
${isDeep ? 'Be comprehensive. Include: (1) zoning implications for future development/resale, (2) comparison vs official land price, (3) investment strategy recommendations (buy/hold/flip). Add a dedicated section on regulatory/planning risks.' : ''}`

  if (process.env.NODE_ENV === 'development') {
    console.log('[reportService] userPrompt sent to Claude:\n', userPrompt)
  }

  // Sonnet-4-6 を主モデルとし、529 overload 時は Haiku-4-5 にフォールバック。
  // Sonnet のほうが分析深度が高いため常時 Sonnet を優先するが、API 過負荷で
  // 失敗し続けると UX が壊れるので、最後の手段としての降格。
  //
  // max_tokens: prompt にマクロデータ（人口/人口移動/建築着工/海抜）を
  // 追加した後、従来の設定では JSON が途中で切れる事象が発生。余裕を持たせる。
  const callArgs = {
    max_tokens: isQuick ? 900 : isDeep ? 3000 : 2000,
    system: systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
  }

  let response
  let modelUsed = 'claude-sonnet-4-6'
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      ...callArgs,
    })
  } catch (e: unknown) {
    const isOverload = e instanceof Anthropic.APIError && (e.status === 529 || e.status === 429)
    if (!isOverload) throw e
    console.warn('[reportService] Sonnet 4.6 overloaded, falling back to Haiku 4.5')
    modelUsed = 'claude-haiku-4-5-20251001'
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      ...callArgs,
    })
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[reportService] model used: ${modelUsed}`)
  }

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return {
      summary: text.slice(0, 200),
      pros: [],
      cons: [],
      recommendation: '',
      investmentScore: 50,
    }
  }
}
