import type { PropertyData } from '../../../shared/types'

/**
 * 楽待 物件ページから情報を抽出する
 * 対象URL例:
 *   https://www.rakumachi.jp/syuuekibukken/mansion/XXXXXXXXXX/
 *   https://www.rakumachi.jp/syuuekibukken/apartment/XXXXXXXXXX/
 *   https://www.rakumachi.jp/syuuekibukken/land/XXXXXXXXXX/
 */
export function parseRakumachi(): PropertyData | null {
  try {
    // ── 価格 ────────────────────────────────────────────────────────────────
    // 楽待は「○○万円」形式で表示
    const priceEl =
      document.querySelector('.property-price .price') ||
      document.querySelector('.priceArea .price') ||
      document.querySelector('[class*="property-price"]') ||
      document.querySelector('.bukken-price') ||
      document.querySelector('.mod-price') ||
      (() => {
        let found: Element | null = null
        document.querySelectorAll('th, dt, .label').forEach(el => {
          const label = el.textContent?.trim() ?? ''
          if (/^(価格|販売価格|売買価格)$/.test(label) && !found) {
            found = el.nextElementSibling
          }
        })
        return found
      })()

    const priceText = priceEl?.textContent?.trim() ?? ''
    const price = parsePriceJpy(priceText)
    if (!price) return null

    // ── 住所 ────────────────────────────────────────────────────────────────
    let address = ''

    document.querySelectorAll('th, dt, .label').forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/^(所在地|住所)$/.test(label) && !address) {
        address = (el.nextElementSibling as HTMLElement)?.textContent?.trim() ?? ''
      }
    })

    // パン粉 or 住所ブロック
    if (!address) {
      const addrEl =
        document.querySelector('.property-address') ||
        document.querySelector('.bukken-address') ||
        document.querySelector('[class*="address"]')
      address = addrEl?.textContent?.trim() ?? ''
    }

    if (!address) return null

    // ── 面積 ────────────────────────────────────────────────────────────────
    let area = 0
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/専有面積|建物面積|土地面積|延床面積/.test(label) && area === 0) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        area = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0
      }
    })

    // ── 築年数 ──────────────────────────────────────────────────────────────
    let age = 0
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/築年月|築年数|建築年月|竣工年月|建築年/.test(label) && age === 0) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        const seirekiMatch = raw.match(/(\d{4})年/)
        if (seirekiMatch) {
          age = new Date().getFullYear() - parseInt(seirekiMatch[1])
        }
        if (age === 0) {
          const warekiMatch = raw.match(/(昭和|平成|令和)(\d+)年/)
          if (warekiMatch) {
            const base = warekiMatch[1] === '昭和' ? 1925
              : warekiMatch[1] === '平成' ? 1988 : 2018
            age = new Date().getFullYear() - (base + parseInt(warekiMatch[2]))
          }
        }
      }
    })

    // ── 建物名 ──────────────────────────────────────────────────────────────
    const name =
      document.querySelector('h1.property-title')?.textContent?.trim() ||
      document.querySelector('.bukken-name')?.textContent?.trim() ||
      document.querySelector('h1.title')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.split('【')[0].split('｜')[0].trim()

    // ── 表面利回り ──────────────────────────────────────────────────────────
    let grossYield: number | undefined
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/表面利回り|想定利回り|利回り/.test(label) && grossYield === undefined) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        const m = raw.match(/(\d+(?:\.\d+)?)%/)
        if (m) grossYield = parseFloat(m[1])
      }
    })

    // ── 管理費 ──────────────────────────────────────────────────────────────
    let managementFee: number | undefined
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      if (/管理費/.test(el.textContent ?? '') && managementFee === undefined) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        const fee = parsePriceJpy(raw)
        if (fee && fee < 200_000) managementFee = fee
      }
    })

    // ── 交通 ────────────────────────────────────────────────────────────────
    const transport: string[] = []
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/^(交通|最寄り駅|アクセス)$/.test(label) && transport.length === 0) {
        const td = el.nextElementSibling as HTMLElement
        const items = td?.querySelectorAll('li, p')
        if (items?.length) {
          items.forEach(item => {
            const text = item.textContent?.trim()
            if (text) transport.push(text)
          })
        } else {
          const raw = td?.textContent?.trim() ?? ''
          raw.split(/\n|　/).forEach(line => {
            const t = line.trim()
            if (t) transport.push(t)
          })
        }
      }
    })

    // ── 階数 ────────────────────────────────────────────────────────────────
    let floor: string | undefined
    ;[...document.querySelectorAll('th, dt, .label')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/所在階|階数/.test(label) && !floor) {
        floor = (el.nextElementSibling as HTMLElement)?.textContent?.trim()
      }
    })

    return {
      url: window.location.href,
      platform: 'rakumachi',
      name,
      address,
      price,
      area,
      age,
      floor,
      managementFee,
      transport: transport.filter(Boolean).slice(0, 3),
      rawData: grossYield !== undefined ? { grossYield } : undefined,
    }
  } catch (e) {
    console.error('[Bukken.io] 楽待 parse error:', e)
    return null
  }
}

// ── 価格テキスト → 円 ───────────────────────────────────────────────────────
function parsePriceJpy(text: string): number {
  if (!text) return 0
  const clean = text.replace(/[,\s]/g, '')

  const okuMan = clean.match(/(\d+(?:\.\d+)?)億(\d+)万/)
  if (okuMan) return Math.round(parseFloat(okuMan[1]) * 1e8 + parseInt(okuMan[2]) * 1e4)

  const oku = clean.match(/(\d+(?:\.\d+)?)億/)
  if (oku) return Math.round(parseFloat(oku[1]) * 1e8)

  const man = clean.match(/(\d+(?:\.\d+)?)万/)
  if (man) return Math.round(parseFloat(man[1]) * 1e4)

  const num = clean.match(/^(\d+)$/)
  if (num) return parseInt(num[1])

  return 0
}
