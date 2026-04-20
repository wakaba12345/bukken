/**
 * 大島てる 事故物件チェッカー
 * ==============================
 * 実装方針：
 *   1. サイト HTML を fetch して parse
 *   2. 完全一致（住所＋フロア）→ 同棟別室 → 近隣 の順でチェック
 *
 * ⚠️ 利用上の注意：
 *   - 大島てる側に正式許諾を得てから本番投入すること
 *   - レート制限：1リクエスト/5秒 + 結果を24時間キャッシュ
 *   - ToS 交渉中は isDryRun=true でモックレスポンスを返す
 */

export interface OshimaEntry {
  address: string
  floor?: string       // 部屋番号・階数
  cause: string        // 死因（殺人、自殺、火災 等）
  detail: string
}

export interface OshimaResult {
  /** 同住所・同フロア完全一致 */
  exactMatch: boolean
  exactEntries: OshimaEntry[]
  /** マンション同棟・別フロア */
  sameBuilding: boolean
  sameBuildingEntries: OshimaEntry[]
  /** 一戸建て隣接（±2番地） */
  nearby: boolean
  nearbyEntries: OshimaEntry[]
  /** 表示用サマリー */
  summary: string
  /** リスクレベル */
  riskLevel: 'none' | 'nearby' | 'same_building' | 'exact'
}

// ─── 設定 ─────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.oshimaland.co.jp'
const RATE_LIMIT_MS = 5000           // 5秒に1回
const CACHE_TTL_SEC = 86400          // 24時間キャッシュ
const DRY_RUN = process.env.OSHIMA_DRY_RUN === 'true'  // 許諾前はtrue

let lastRequestTime = 0

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export async function checkOshimaland(params: {
  address: string
  floor?: string
  propertyType?: 'mansion' | 'house'
}): Promise<OshimaResult> {
  const { address, floor, propertyType = 'mansion' } = params

  // 許諾前はモックレスポンスを返す
  if (DRY_RUN) {
    return mockResult(address)
  }

  // レート制限
  const now = Date.now()
  const wait = RATE_LIMIT_MS - (now - lastRequestTime)
  if (wait > 0) await sleep(wait)
  lastRequestTime = Date.now()

  // HTML 取得
  const html = await fetchOshimaland(address)
  if (!html) {
    return emptyResult('大島てるへの接続に失敗しました')
  }

  // パース
  const entries = parseEntries(html)

  // マッチング
  const normAddr = normalizeAddress(address)

  const exactEntries: OshimaEntry[] = []
  const sameBuildingEntries: OshimaEntry[] = []
  const nearbyEntries: OshimaEntry[] = []

  for (const entry of entries) {
    const normEntry = normalizeAddress(entry.address)

    // 完全一致
    if (normEntry === normAddr) {
      if (floor && entry.floor) {
        if (normalizeFloor(floor) === normalizeFloor(entry.floor)) {
          exactEntries.push(entry)
        } else {
          sameBuildingEntries.push(entry)
        }
      } else {
        exactEntries.push(entry)
      }
    }
    // 同棟（マンション）
    else if (
      propertyType === 'mansion' &&
      (normAddr.includes(normEntry) || normEntry.includes(normAddr))
    ) {
      sameBuildingEntries.push(entry)
    }
    // 近隣（一戸建て）
    else if (propertyType === 'house' && isNearbyAddress(normAddr, normEntry, 2)) {
      nearbyEntries.push(entry)
    }
  }

  const riskLevel = exactEntries.length > 0 ? 'exact'
    : sameBuildingEntries.length > 0 ? 'same_building'
    : nearbyEntries.length > 0 ? 'nearby'
    : 'none'

  const summary = buildSummary(exactEntries, sameBuildingEntries, nearbyEntries, propertyType)

  return {
    exactMatch: exactEntries.length > 0,
    exactEntries,
    sameBuilding: sameBuildingEntries.length > 0,
    sameBuildingEntries,
    nearby: nearbyEntries.length > 0,
    nearbyEntries,
    summary,
    riskLevel,
  }
}

// ─── HTML 取得 ────────────────────────────────────────────────────────────────

async function fetchOshimaland(address: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/?q=${encodeURIComponent(address)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bukken.io/1.0)',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Referer': BASE_URL,
      },
      next: { revalidate: CACHE_TTL_SEC },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ─── HTML パース ──────────────────────────────────────────────────────────────

function parseEntries(html: string): OshimaEntry[] {
  const entries: OshimaEntry[] = []

  // パターン1: var locations = [{...}] 形式
  const jsMatch = html.match(/var\s+locations\s*=\s*(\[[\s\S]*?\]);/)
  if (jsMatch) {
    try {
      const data = JSON.parse(jsMatch[1]) as Record<string, string>[]
      for (const item of data) {
        if (item.address) {
          entries.push({
            address: item.address,
            floor: item.floor ?? item.room,
            cause: item.cause ?? '不明',
            detail: item.detail ?? '',
          })
        }
      }
      if (entries.length > 0) return entries
    } catch {}
  }

  // パターン2: data-address 属性
  const markerPattern = /data-address="([^"]+)"[^>]*(?:data-floor="([^"]*)")?[^>]*(?:data-cause="([^"]*)")?/g
  let match
  while ((match = markerPattern.exec(html)) !== null) {
    entries.push({
      address: match[1],
      floor: match[2] || undefined,
      cause: match[3] || '不明',
      detail: '',
    })
  }

  // パターン3: JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (jsonLdMatch && entries.length === 0) {
    try {
      const data = JSON.parse(jsonLdMatch[1])
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item.address) {
          entries.push({
            address: typeof item.address === 'string' ? item.address : item.address?.streetAddress ?? '',
            cause: item.additionalType ?? '不明',
            detail: item.description ?? '',
          })
        }
      }
    } catch {}
  }

  return entries
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function normalizeAddress(addr: string): string {
  return addr
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－ーｰ−]/g, '-')
    .replace(/\s/g, '')
    .replace(/丁目/g, '-')
    .replace(/番地?/g, '-')
    .replace(/号$/g, '')
}

function normalizeFloor(floor: string): string {
  return floor
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ff階号室]/g, '')
    .trim()
}

function isNearbyAddress(addr1: string, addr2: string, range: number): boolean {
  const nums1 = addr1.match(/\d+/g)
  const nums2 = addr2.match(/\d+/g)
  if (!nums1 || !nums2 || nums1.length < 3 || nums2.length < 3) return false
  // 丁目・番が一致し、号が±range以内
  if (nums1[0] === nums2[0] && nums1[1] === nums2[1]) {
    return Math.abs(parseInt(nums1[2]) - parseInt(nums2[2])) <= range
  }
  return false
}

function buildSummary(
  exact: OshimaEntry[],
  sameBuilding: OshimaEntry[],
  nearby: OshimaEntry[],
  propType: string,
): string {
  if (exact.length > 0) {
    const causes = [...new Set(exact.map(e => e.cause))].join('・')
    const floors = exact.map(e => e.floor).filter(Boolean).join('・')
    return `⚠️ この物件${floors ? `（${floors}）` : ''}は大島てるに登録あり：${causes}`
  }
  if (sameBuilding.length > 0 && propType === 'mansion') {
    const causes = [...new Set(sameBuilding.map(e => e.cause))].join('・')
    const floors = sameBuilding.map(e => e.floor).filter(Boolean).join('・')
    return `ℹ️ 同棟の別室${floors ? `（${floors}）` : ''}に登録あり：${causes}`
  }
  if (nearby.length > 0 && propType === 'house') {
    return `ℹ️ 近隣${nearby.length}件に事故物件登録あり`
  }
  return '✅ 大島てる登録なし'
}

function emptyResult(summary: string): OshimaResult {
  return {
    exactMatch: false, exactEntries: [],
    sameBuilding: false, sameBuildingEntries: [],
    nearby: false, nearbyEntries: [],
    summary, riskLevel: 'none',
  }
}

function mockResult(address: string): OshimaResult {
  return {
    ...emptyResult(`[DRY RUN] ${address} のチェックをスキップ`),
    summary: '[DRY RUN] 大島てる未許諾のためスキップ',
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
