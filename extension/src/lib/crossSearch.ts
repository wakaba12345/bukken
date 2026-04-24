/**
 * 跨平台物件搜尋（リンクモード）
 * ================================
 * 各プラットフォームのスクレイピングは信頼性が低い：
 *   - athome / 楽待：WAF（F5/Cloudflare）で bot 拒否
 *   - HOME'S / Yahoo：DOM 構造が頻繁に変わる
 *   - extension fetch は chrome-extension:// origin で送られるため弾かれることがある
 *
 * 現状の設計：
 *   各プラットフォームの正しい検索 URL を組み立て、ユーザーがリンクをクリックして
 *   各サイトで確認できるようにする。構造化された価格比較は将来 SerpAPI 経由で再実装。
 */

export interface PlatformSearchResult {
  platform: string
  platformLabel: string
  url: string
  listings: Listing[]
  error?: string
}

export interface Listing {
  name: string
  price: number
  priceText: string
  area?: number
  url: string
}

interface PlatformConfig {
  label: string
  buildSearchUrl: (keyword: string) => string
}

const PLATFORMS: PlatformConfig[] = [
  {
    label: 'SUUMO',
    buildSearchUrl: (kw) =>
      `https://suumo.jp/jj/common/ichiran/JJ901FC100/?TC=0101_0101&KW=${encodeURIComponent(kw)}`,
  },
  {
    label: 'athome',
    buildSearchUrl: (kw) =>
      `https://www.athome.co.jp/mansion/chuko/?keyword=${encodeURIComponent(kw)}`,
  },
  {
    label: "HOME'S",
    buildSearchUrl: (kw) =>
      `https://www.homes.co.jp/mansion/chuko/list/?q=${encodeURIComponent(kw)}`,
  },
  {
    label: 'Yahoo!不動産',
    buildSearchUrl: (kw) =>
      `https://realestate.yahoo.co.jp/used/mansion/search/?keyword=${encodeURIComponent(kw)}`,
  },
  {
    label: '楽待',
    buildSearchUrl: (kw) =>
      `https://www.rakumachi.jp/syuuekibukken/list/?keyword=${encodeURIComponent(kw)}`,
  },
  {
    label: '健美家',
    buildSearchUrl: (kw) =>
      `https://www.kenbiya.com/ar/ns/?q=${encodeURIComponent(kw)}`,
  },
  {
    label: 'マンションノート',
    buildSearchUrl: (kw) =>
      `https://www.mansion-note.com/mansion/search?q=${encodeURIComponent(kw)}`,
  },
  {
    label: 'マンションレビュー',
    buildSearchUrl: (kw) =>
      // 公式の検索URLが不安定なため Google site: 検索を経由（第1件目が建物ページのことが多い）
      `https://www.google.com/search?q=${encodeURIComponent('site:mansion-review.jp "' + kw + '"')}`,
  },
]

export async function searchAllPlatforms(
  buildingName: string | undefined,
  address: string,
  currentPlatform: string,
): Promise<PlatformSearchResult[]> {
  const keyword = buildingName?.trim() || extractKeyword(address)
  const targets = PLATFORMS.filter(
    p => p.label.toLowerCase() !== currentPlatform.toLowerCase()
  )
  return targets.map(p => ({
    platform:      p.label,
    platformLabel: p.label,
    url:           p.buildSearchUrl(keyword),
    listings:      [],
  }))
}

function extractKeyword(address: string): string {
  const m = address.match(/(?:都|道|府|県)(.{2,8}(?:市|区|町|村))(.{2,8})?/)
  return m ? (m[1] + (m[2] ?? '')).replace(/\d|-|ー/g, '') : address.slice(0, 10)
}
