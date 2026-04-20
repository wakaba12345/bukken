import Anthropic from '@anthropic-ai/sdk'
import type {
  PropertyData,
  FeatureKey,
  ReportContent,
  DisasterRisk,
  AreaMarket,
} from 'shared/types'
import { geocode } from '../lib/apis/geocode'
import { getEarthquakeRisk } from '../lib/apis/jshis'
import { getDisasterRisk } from '../lib/apis/reinfolib'
import { getAreaMarket } from '../lib/apis/fudosandb'
import { getNearbyTransactions, type AreaTransactionResult } from '../lib/apis/landprice'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  // ── 並列でデータ取得 ────────────────────────────────────────────────────
  const [disasterRisk, areaMarket, landTransactions] = await Promise.allSettled([
    lat && lng ? fetchDisasterRisk(lat, lng) : Promise.resolve(undefined),
    lat && lng ? getAreaMarket(property.address, lat, lng) : Promise.resolve(undefined),
    getNearbyTransactions(property.address),
  ])

  const disaster     = disasterRisk.status === 'fulfilled'     ? disasterRisk.value     : undefined
  const market       = areaMarket.status === 'fulfilled'       ? (areaMarket.value ?? undefined) : undefined
  const transactions = landTransactions.status === 'fulfilled' ? landTransactions.value : undefined

  // ── Claude API でレポート生成 ────────────────────────────────────────────
  const aiAnalysis = await generateAiAnalysis(property, type, disaster, market, transactions)

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

  // リスクスコア算出 (0-100, 100=最安全)
  let score = 100
  if (eq?.prob30yr6Strong) score -= eq.prob30yr6Strong * 40
  if (rd?.floodRisk === 'high')      score -= 20
  if (rd?.floodRisk === 'very_high') score -= 30
  if (rd?.landslideRisk === 'high')  score -= 15

  return {
    earthquake30yr: eq?.prob30yr6Strong ?? 0,
    floodRisk: rd?.floodRisk ?? 'none',
    landslideRisk: rd?.landslideRisk ?? 'none',
    tsunamiRisk: rd?.tsunamiRisk ?? 'none',
    overallScore: Math.max(0, Math.round(score)),
  }
}

async function generateAiAnalysis(
  property: PropertyData,
  type: FeatureKey,
  disaster?: DisasterRisk,
  market?: AreaMarket,
  transactions?: AreaTransactionResult | null,
) {
  const isQuick = type === 'quick_summary'
  const isDeep  = type === 'deep_report'

  const systemPrompt = `You are a Japanese real estate analyst. Analyze properties for investors, primarily from Taiwan and Japan.
Always respond in ${isDeep ? 'detailed' : 'concise'} format.
Focus on investment potential, risk factors, and actionable insights.
Output must be valid JSON only, no markdown.`

  const userPrompt = `Analyze this property and return JSON with this exact structure:
{
  "summary": "2-3 sentence overview",
  "pros": ["pro1", "pro2", "pro3"],
  "cons": ["con1", "con2"],
  "recommendation": "1-2 sentence actionable advice",
  "investmentScore": 75
}

Property data:
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
- Earthquake (30yr 震度6強 probability): ${(disaster.earthquake30yr * 100).toFixed(1)}%
- Flood risk: ${disaster.floodRisk}
- Overall safety score: ${disaster.overallScore}/100` : ''}

${transactions && transactions.count > 0 ? `
Nearby actual transaction prices (国土交通省 成約データ, last 2 years):
- Transactions found: ${transactions.count}件
- Avg price/㎡: ¥${transactions.avgPricePerSqm.toLocaleString()}
- Median transaction price: ¥${transactions.medianPrice.toLocaleString()}
- Sample transactions:
${transactions.transactions.slice(0, 5).map(t =>
  `  • ¥${t.price.toLocaleString()} / ${t.area}㎡ (¥${t.pricePerSqm.toLocaleString()}/㎡)${t.floorPlan ? ` ${t.floorPlan}` : ''}${t.buildingYear ? ` 築${new Date().getFullYear() - t.buildingYear}年` : ''} ${t.period}`
).join('\n')}` : ''}

${isQuick ? 'Be very concise. Max 100 words for summary.' : ''}
${isDeep ? 'Be comprehensive. Include investment strategy recommendations.' : ''}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: isQuick ? 400 : isDeep ? 1200 : 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

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
