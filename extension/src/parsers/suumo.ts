import type { PropertyData } from '../../../shared/types'

/**
 * SUUMO 物件ページから情報を抽出する
 * 対象URL例:
 *   https://suumo.jp/ms/chuko/tokyo/sc_shibuya/nc_XXXXXXXX/
 *   https://suumo.jp/jj/bukken/shosai/JJ012FD010/?ar=030&bs=021&nc=XXXXXXXX
 */
export function parseSuumo(): PropertyData | null {
  try {
    // ── 価格 ────────────────────────────────────────────────────────────────
    const priceEl =
      document.querySelector('.detailbody-mainprice') ||          // 中古マンション
      document.querySelector('[class*="price"] .num') ||
      document.querySelector('.bukkenPrice') ||
      document.querySelector('[data-testid="price"]')

    const priceText = priceEl?.textContent?.trim() ?? ''
    const price = parsePriceJpy(priceText)
    if (!price) return null

    // ── 住所 ────────────────────────────────────────────────────────────────
    const addressEl =
      document.querySelector('.detailbody-info-titleaddress') ||
      document.querySelector('[class*="address"]') ||
      document.querySelector('th:has(+ td)')

    let address = ''
    // テーブル形式で「所在地」を探す
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('所在地')) {
        address = (th.nextElementSibling as HTMLElement)?.textContent?.trim() ?? ''
      }
    })
    if (!address) address = addressEl?.textContent?.trim() ?? ''
    if (!address) return null

    // ── 面積 ────────────────────────────────────────────────────────────────
    let area = 0
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('専有面積') || th.textContent?.includes('建物面積')) {
        const areaText = (th.nextElementSibling as HTMLElement)?.textContent ?? ''
        area = parseFloat(areaText.replace(/[^0-9.]/g, '')) || 0
      }
    })

    // ── 築年数 ──────────────────────────────────────────────────────────────
    let age = 0
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('築年月') || th.textContent?.includes('築年数')) {
        const ageText = (th.nextElementSibling as HTMLElement)?.textContent ?? ''
        const yearMatch = ageText.match(/(\d{4})年/)
        if (yearMatch) {
          age = new Date().getFullYear() - parseInt(yearMatch[1])
        }
      }
    })

    // ── 建物名 ──────────────────────────────────────────────────────────────
    const name =
      document.querySelector('h1.detailbody-title')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.split('｜')[0].trim()

    // ── 管理費 ──────────────────────────────────────────────────────────────
    let managementFee: number | undefined
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('管理費')) {
        const feeText = (th.nextElementSibling as HTMLElement)?.textContent ?? ''
        const fee = parsePriceJpy(feeText)
        if (fee) managementFee = fee
      }
    })

    // ── 交通 ────────────────────────────────────────────────────────────────
    const transport: string[] = []
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('交通')) {
        const td = th.nextElementSibling as HTMLElement
        td?.querySelectorAll('li, p, div').forEach(el => {
          const text = el.textContent?.trim()
          if (text) transport.push(text)
        })
        if (!transport.length) {
          const text = td?.textContent?.trim()
          if (text) transport.push(text)
        }
      }
    })

    // ── 階数 ────────────────────────────────────────────────────────────────
    let floor: string | undefined
    document.querySelectorAll('th').forEach(th => {
      if (th.textContent?.includes('階')) {
        const text = (th.nextElementSibling as HTMLElement)?.textContent?.trim()
        if (text) floor = text
      }
    })

    return {
      url: window.location.href,
      platform: 'suumo',
      name,
      address,
      price,
      area,
      age,
      floor,
      managementFee,
      transport,
    }
  } catch (e) {
    console.error('[Bukken.io] SUUMO parse error:', e)
    return null
  }
}

/**
 * 価格テキストを円（数値）に変換
 * "6,280万円" → 62800000
 * "1億2,000万円" → 120000000
 * "12万円/月" → 120000
 */
function parsePriceJpy(text: string): number {
  if (!text) return 0
  const clean = text.replace(/[,\s]/g, '')

  // 億 + 万
  const okuMan = clean.match(/(\d+(?:\.\d+)?)億(\d+)万/)
  if (okuMan) {
    return Math.round(parseFloat(okuMan[1]) * 1e8 + parseInt(okuMan[2]) * 1e4)
  }

  // 億のみ
  const oku = clean.match(/(\d+(?:\.\d+)?)億/)
  if (oku) {
    return Math.round(parseFloat(oku[1]) * 1e8)
  }

  // 万のみ
  const man = clean.match(/(\d+(?:\.\d+)?)万/)
  if (man) {
    return Math.round(parseFloat(man[1]) * 1e4)
  }

  // 数字のみ（管理費など）
  const num = clean.match(/(\d+)/)
  if (num) return parseInt(num[1])

  return 0
}
