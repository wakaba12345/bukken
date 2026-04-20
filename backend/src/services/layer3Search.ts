/**
 * 第三層：Google 拡大検索エンジン
 * ==================================
 * 政府APIでは取得できない情報を、Google検索で発掘する。
 *
 * ターゲット情報：
 *   - 管理組合の問題（修繕積立金不足・理事会紛争）
 *   - 過去の事件・事故（ニュース・掲示板）
 *   - 住民投稿・クチコミ（マンションコミュニティ等）
 *   - 建物の技術的問題（外壁・配管・エレベーター）
 *   - 売主・仲介業者の評判
 *
 * 実装方針：
 *   SerpAPI を使用（$50/月 starter、月5000回）
 *   結果は Claude API でフィルタリング・要約
 *   24時間キャッシュ（同一マンションの重複検索を防ぐ）
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const SERP_API_KEY = process.env.SERP_API_KEY

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface SearchFinding {
  category: FindingCategory
  severity: 'info' | 'caution' | 'warning' | 'critical'
  title: string
  summary: string
  summaryZh: string
  source: string
  url: string
  date?: string
}

export type FindingCategory =
  | 'MANAGEMENT_ISSUE'      // 管理組合・修繕積立金問題
  | 'INCIDENT'              // 過去の事件・事故
  | 'RESIDENT_COMPLAINT'    // 住民クチコミ・投稿
  | 'STRUCTURAL_ISSUE'      // 建物の技術的問題
  | 'LEGAL_ISSUE'           // 法的問題（差押え・競売等）
  | 'REPUTATION'            // 売主・仲介業者の評判

export interface Layer3Result {
  buildingName: string
  findings: SearchFinding[]
  searchQueries: string[]      // 実行したクエリ（透明性のため）
  hasIssues: boolean
  issueCount: number
  summary: string
  summaryZh: string
}

// ─── 検索クエリ生成 ───────────────────────────────────────────────────────────

function buildSearchQueries(params: {
  buildingName?: string
  address: string
  area: string               // 区・市区町村レベル
}): string[] {
  const { buildingName, address, area } = params
  const base = buildingName || address

  const queries: string[] = []

  // 管理問題系
  if (buildingName) {
    queries.push(`"${buildingName}" 管理組合 問題`)
    queries.push(`"${buildingName}" 修繕積立金 不足`)
    queries.push(`"${buildingName}" トラブル OR 問題 OR 欠陥`)
    queries.push(`"${buildingName}" 住民 投稿 OR 口コミ`)
  }

  // 事件・事故系
  queries.push(`"${base}" 事件 OR 事故 OR 火災 site:news.google.com OR site:nhk.or.jp`)

  // 建物問題系
  if (buildingName) {
    queries.push(`"${buildingName}" 外壁 OR 配管 OR 雨漏り OR 傾き`)
    queries.push(`"${buildingName}" 大規模修繕 OR アスベスト`)
  }

  // 法的問題系（競売・差押え）
  queries.push(`"${base}" 競売 OR 差押え OR 任意売却`)

  // マンションコミュニティ系
  if (buildingName) {
    queries.push(`"${buildingName}" site:mansion-community.net OR site:e-mansion.co.jp`)
  }

  // エリア固有の問題
  queries.push(`${area} マンション 管理問題 ${new Date().getFullYear()}`)

  return queries.slice(0, 8) // 最大8クエリ（コスト管理）
}

// ─── SerpAPI 呼び出し ─────────────────────────────────────────────────────────

interface SerpResult {
  title: string
  link: string
  snippet: string
  date?: string
}

async function searchGoogle(query: string): Promise<SerpResult[]> {
  if (!SERP_API_KEY) {
    console.warn('[Layer3] SERP_API_KEY not set, returning mock')
    return []
  }

  try {
    const url = new URL('https://serpapi.com/search')
    url.searchParams.set('q', query)
    url.searchParams.set('hl', 'ja')
    url.searchParams.set('gl', 'jp')
    url.searchParams.set('num', '5')
    url.searchParams.set('api_key', SERP_API_KEY)

    const res = await fetch(url.toString(), {
      next: { revalidate: 86400 }, // 24時間キャッシュ
    })

    if (!res.ok) return []

    const data = await res.json()
    return (data.organic_results ?? []).map((r: Record<string, string>) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      date: r.date,
    }))
  } catch (e) {
    console.error('[Layer3] SerpAPI error:', e)
    return []
  }
}

// ─── Claude による結果フィルタリング・分類 ────────────────────────────────────

async function filterAndClassify(
  rawResults: { query: string; results: SerpResult[] }[],
  buildingName: string,
  address: string,
): Promise<SearchFinding[]> {
  if (rawResults.every(r => r.results.length === 0)) return []

  const context = rawResults
    .flatMap(r => r.results.map(res => `[${r.query}]\n${res.title}\n${res.snippet}\n${res.link}`))
    .join('\n\n---\n\n')
    .slice(0, 3000) // token制限

  const prompt = `以下は「${buildingName || address}」に関するGoogle検索結果です。
不動産投資家にとって重要な問題（管理問題・事件事故・建物欠陥・法的問題）が含まれる検索結果のみを抽出し、JSON形式で返してください。

無関係な結果（単なる物件情報・不動産広告・関係ない同名物件）は除外してください。

出力形式（JSON only、マークダウン不要）：
{
  "findings": [
    {
      "category": "MANAGEMENT_ISSUE|INCIDENT|RESIDENT_COMPLAINT|STRUCTURAL_ISSUE|LEGAL_ISSUE|REPUTATION",
      "severity": "info|caution|warning|critical",
      "title": "簡潔なタイトル（日本語）",
      "summary": "2-3文の要約（日本語）",
      "summaryZh": "2-3文の要約（繁体字中国語）",
      "source": "メディア名またはサイト名",
      "url": "URL",
      "date": "日付（あれば）"
    }
  ]
}

検索結果：
${context}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return parsed.findings ?? []
  } catch (e) {
    console.error('[Layer3] Claude classification error:', e)
    return []
  }
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export async function runLayer3Search(params: {
  buildingName?: string
  address: string
  area: string
}): Promise<Layer3Result> {
  const { buildingName, address, area } = params

  // クエリ生成
  const queries = buildSearchQueries({ buildingName, address, area })

  // 並列検索（最大4並列でAPI負荷を抑える）
  const BATCH_SIZE = 4
  const allResults: { query: string; results: SerpResult[] }[] = []

  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async q => ({ query: q, results: await searchGoogle(q) }))
    )
    allResults.push(...batchResults)
  }

  // Claude でフィルタリング・分類
  const findings = await filterAndClassify(allResults, buildingName ?? '', address)

  // 深刻度でソート
  const severityOrder = { critical: 0, warning: 1, caution: 2, info: 3 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  // サマリー生成
  const hasIssues = findings.some(f => f.severity !== 'info')
  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const warningCount = findings.filter(f => f.severity === 'warning').length

  let summary = ''
  let summaryZh = ''

  if (findings.length === 0) {
    summary = 'Google検索でネガティブな情報は見つかりませんでした。'
    summaryZh = 'Google 搜尋未發現負面資訊。'
  } else if (criticalCount > 0) {
    summary = `重大な問題${criticalCount}件を含む${findings.length}件の情報を検出。詳細確認を強く推奨します。`
    summaryZh = `發現包含 ${criticalCount} 件重大問題在內共 ${findings.length} 項資訊，強烈建議詳細確認。`
  } else if (warningCount > 0) {
    summary = `注意すべき情報${warningCount}件を含む${findings.length}件の情報を検出。`
    summaryZh = `發現包含 ${warningCount} 件注意事項在內共 ${findings.length} 項資訊。`
  } else {
    summary = `参考情報${findings.length}件を検出。重大な問題は見当たりません。`
    summaryZh = `發現 ${findings.length} 項參考資訊，未見重大問題。`
  }

  return {
    buildingName: buildingName ?? address,
    findings,
    searchQueries: queries,
    hasIssues,
    issueCount: findings.length,
    summary,
    summaryZh,
  }
}

// ─── 区・市区町村の抽出ヘルパー ───────────────────────────────────────────────

export function extractArea(address: string): string {
  // 「東京都渋谷区」→「渋谷区」
  const match = address.match(/(?:都|道|府|県)(.{2,5}(?:市|区|町|村))/)
  return match ? match[1] : address.split(/\d/)[0].slice(-4)
}
