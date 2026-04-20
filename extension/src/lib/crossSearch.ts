/**
 * 跨平台物件搜尋（瀏覽器端直接 fetch）
 * ========================================
 * 使用者的瀏覽器直接對各平台發出請求，避免伺服器端被封鎖。
 * 搜尋同一棟建物在其他平台是否有不同價格的刊登。
 */

export interface PlatformSearchResult {
  platform: string
  platformLabel: string
  url: string          // 搜尋結果頁 URL
  listings: Listing[]
  error?: string
}

export interface Listing {
  name: string
  price: number        // 円（0 = 解析失敗）
  priceText: string    // 原始價格文字
  area?: number        // ㎡
  url: string          // 物件頁 URL
}

// ── 各平台搜尋設定 ────────────────────────────────────────────────────────────

interface PlatformConfig {
  label: string
  buildSearchUrl: (keyword: string) => string
  parseResults: (doc: Document, baseUrl: string) => Listing[]
}

const PLATFORMS: PlatformConfig[] = [
  // ── SUUMO ──────────────────────────────────────────────────────────────────
  {
    label: 'SUUMO',
    buildSearchUrl: (kw) =>
      `https://suumo.jp/ms/chuko/list/?fw2=${encodeURIComponent(kw)}&sort=1`,
    parseResults: (doc, base) => {
      const items: Listing[] = []
      doc.querySelectorAll('.cassetteitem').forEach(el => {
        const nameEl = el.querySelector('.cassetteitem_content-title, h2.property_unit-title, .cassetteitem-body-title')
        const priceEl = el.querySelector('.cassetteitem_price--rent, .cassetteitem_price, [class*="price"]')
        const linkEl = el.querySelector('a[href*="/ms/chuko/"]') as HTMLAnchorElement | null
        if (!nameEl && !priceEl) return
        const priceText = priceEl?.textContent?.trim() ?? ''
        items.push({
          name:      nameEl?.textContent?.trim() ?? '',
          price:     parsePriceJpy(priceText),
          priceText,
          url: linkEl ? toAbsolute((linkEl.href || linkEl.getAttribute('href')) ?? '', base) : base,
        })
      })
      return items.slice(0, 5)
    },
  },

  // ── athome ─────────────────────────────────────────────────────────────────
  {
    label: 'athome',
    buildSearchUrl: (kw) =>
      `https://www.athome.co.jp/search/sch_bukken.php?bk=MANSION&pw=${encodeURIComponent(kw)}&display=LIST`,
    parseResults: (doc, base) => {
      const items: Listing[] = []
      doc.querySelectorAll('.object, .property-unit, [class*="bukken"]').forEach(el => {
        const nameEl = el.querySelector('h2, h3, .object__ttl, [class*="title"]')
        const priceEl = el.querySelector('.object__price, [class*="price"]')
        const linkEl = el.querySelector('a') as HTMLAnchorElement | null
        if (!priceEl) return
        const priceText = priceEl?.textContent?.trim() ?? ''
        items.push({
          name:      nameEl?.textContent?.trim() ?? '',
          price:     parsePriceJpy(priceText),
          priceText,
          url: linkEl ? toAbsolute((linkEl.href || linkEl.getAttribute('href')) ?? '', base) : base,
        })
      })
      return items.slice(0, 5)
    },
  },

  // ── HOME'S ─────────────────────────────────────────────────────────────────
  {
    label: "HOME'S",
    buildSearchUrl: (kw) =>
      `https://www.homes.co.jp/mansion/b-list/?q=${encodeURIComponent(kw)}`,
    parseResults: (doc, base) => {
      const items: Listing[] = []
      doc.querySelectorAll('.item-list__item, [class*="bukken"], .mod-mergeList__item').forEach(el => {
        const nameEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]')
        const priceEl = el.querySelector('[class*="price"], .price')
        const linkEl = el.querySelector('a') as HTMLAnchorElement | null
        if (!priceEl) return
        const priceText = priceEl?.textContent?.trim() ?? ''
        items.push({
          name:      nameEl?.textContent?.trim() ?? '',
          price:     parsePriceJpy(priceText),
          priceText,
          url: linkEl ? toAbsolute((linkEl.href || linkEl.getAttribute('href')) ?? '', base) : base,
        })
      })
      return items.slice(0, 5)
    },
  },

  // ── Yahoo!不動産 ────────────────────────────────────────────────────────────
  {
    label: 'Yahoo!不動産',
    buildSearchUrl: (kw) =>
      `https://realestate.yahoo.co.jp/sell/mansion/list/?q=${encodeURIComponent(kw)}`,
    parseResults: (doc, base) => {
      const items: Listing[] = []
      doc.querySelectorAll('[class*="property"], [class*="bukken"], article').forEach(el => {
        const nameEl = el.querySelector('h2, h3, [class*="title"]')
        const priceEl = el.querySelector('[class*="price"]')
        const linkEl = el.querySelector('a') as HTMLAnchorElement | null
        if (!priceEl) return
        const priceText = priceEl?.textContent?.trim() ?? ''
        items.push({
          name:      nameEl?.textContent?.trim() ?? '',
          price:     parsePriceJpy(priceText),
          priceText,
          url: linkEl ? toAbsolute((linkEl.href || linkEl.getAttribute('href')) ?? '', base) : base,
        })
      })
      return items.slice(0, 5)
    },
  },

  // ── 楽待 ────────────────────────────────────────────────────────────────────
  {
    label: '楽待',
    buildSearchUrl: (kw) =>
      `https://www.rakumachi.jp/syuuekibukken/list/?keyword=${encodeURIComponent(kw)}`,
    parseResults: (doc, base) => {
      const items: Listing[] = []
      doc.querySelectorAll('[class*="property"], [class*="bukken"], .rakumachi-item').forEach(el => {
        const nameEl = el.querySelector('h2, h3, [class*="title"]')
        const priceEl = el.querySelector('[class*="price"]')
        const linkEl = el.querySelector('a') as HTMLAnchorElement | null
        if (!priceEl) return
        const priceText = priceEl?.textContent?.trim() ?? ''
        items.push({
          name:      nameEl?.textContent?.trim() ?? '',
          price:     parsePriceJpy(priceText),
          priceText,
          url: linkEl ? toAbsolute((linkEl.href || linkEl.getAttribute('href')) ?? '', base) : base,
        })
      })
      return items.slice(0, 5)
    },
  },
]

// ── メイン関数 ────────────────────────────────────────────────────────────────

/**
 * 建物名 or 住所を使って各プラットフォームを並列検索
 */
export async function searchAllPlatforms(
  buildingName: string | undefined,
  address: string,
  currentPlatform: string,
): Promise<PlatformSearchResult[]> {
  const keyword = buildingName?.trim() || extractKeyword(address)

  // 現在のプラットフォームを除く
  const targets = PLATFORMS.filter(
    p => p.label.toLowerCase() !== currentPlatform.toLowerCase()
  )

  const results = await Promise.allSettled(
    targets.map(p => searchPlatform(p, keyword))
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: targets[i].label, platformLabel: targets[i].label, url: '', listings: [], error: '取得失敗' }
  )
}

async function searchPlatform(
  config: PlatformConfig,
  keyword: string,
): Promise<PlatformSearchResult> {
  const searchUrl = config.buildSearchUrl(keyword)

  try {
    const res = await fetch(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    })

    if (!res.ok) {
      return { platform: config.label, platformLabel: config.label, url: searchUrl, listings: [], error: `HTTP ${res.status}` }
    }

    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const listings = config.parseResults(doc, searchUrl)

    return { platform: config.label, platformLabel: config.label, url: searchUrl, listings }
  } catch (e) {
    return { platform: config.label, platformLabel: config.label, url: searchUrl, listings: [], error: '接続エラー' }
  }
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function parsePriceJpy(text: string): number {
  if (!text) return 0
  const clean = text.replace(/[,\s\n]/g, '')
  const okuMan = clean.match(/(\d+(?:\.\d+)?)億(\d+)万/)
  if (okuMan) return Math.round(parseFloat(okuMan[1]) * 1e8 + parseInt(okuMan[2]) * 1e4)
  const oku = clean.match(/(\d+(?:\.\d+)?)億/)
  if (oku) return Math.round(parseFloat(oku[1]) * 1e8)
  const man = clean.match(/(\d+(?:\.\d+)?)万/)
  if (man) return Math.round(parseFloat(man[1]) * 1e4)
  return 0
}

function toAbsolute(href: string, base: string): string {
  if (!href) return base
  try { return new URL(href, base).href } catch { return base }
}

function extractKeyword(address: string): string {
  // 「東京都渋谷区神南1-2-3」→「渋谷区神南」（マンション名がない場合の代替）
  const m = address.match(/(?:都|道|府|県)(.{2,8}(?:市|区|町|村))(.{2,8})?/)
  return m ? (m[1] + (m[2] ?? '')).replace(/\d|-|ー/g, '') : address.slice(0, 10)
}
