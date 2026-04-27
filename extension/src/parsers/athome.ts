import type { PropertyData } from '../../../shared/types'
import { extractStructure, parseFeatures, parseSeismicRetrofit } from './featuresHelper'

/**
 * athome のラベル・値ペアを取得するヘルパー（th/dt 構造、tableMap 化して効率化）
 */
function buildAthomeMap(): Map<string, string> {
  const m = new Map<string, string>()
  document.querySelectorAll('th, dt').forEach(el => {
    const label = el.textContent?.trim()
    if (!label) return
    const next = el.nextElementSibling as HTMLElement | null
    if (!next) return
    if (!m.has(label)) m.set(label, next.textContent?.trim() ?? '')
  })
  return m
}

/**
 * athome 物件ページから情報を抽出する
 * 対象URL例:
 *   https://www.athome.co.jp/mansion/XXXXXXXX/
 *   https://www.athome.co.jp/kodate/XXXXXXXX/
 */
export function parseAthome(): PropertyData | null {
  try {
    // ── 価格 ────────────────────────────────────────────────────────────────
    const priceEl =
      document.querySelector('.price-num') ||
      document.querySelector('[class*="price"] strong') ||
      document.querySelector('.bukken-price')

    const priceText = priceEl?.textContent?.trim() ?? ''
    const price = parsePriceJpy(priceText)
    if (!price) return null

    // ── 住所 ────────────────────────────────────────────────────────────────
    let address = ''
    document.querySelectorAll('th, dt').forEach(el => {
      if (el.textContent?.includes('所在地')) {
        const next = el.nextElementSibling as HTMLElement
        address = next?.textContent?.trim() ?? ''
      }
    })
    if (!address) return null

    // ── 面積 ────────────────────────────────────────────────────────────────
    let area = 0
    document.querySelectorAll('th, dt').forEach(el => {
      if (el.textContent?.includes('専有面積') || el.textContent?.includes('建物面積')) {
        const next = el.nextElementSibling as HTMLElement
        area = parseFloat(next?.textContent?.replace(/[^0-9.]/g, '') ?? '0') || 0
      }
    })

    // ── 築年数 ──────────────────────────────────────────────────────────────
    let age = 0
    document.querySelectorAll('th, dt').forEach(el => {
      if (el.textContent?.includes('築年')) {
        const next = el.nextElementSibling as HTMLElement
        const yearMatch = next?.textContent?.match(/(\d{4})年/)
        if (yearMatch) age = new Date().getFullYear() - parseInt(yearMatch[1])
      }
    })

    // ── 建物名 ──────────────────────────────────────────────────────────────
    const name =
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.split('|')[0].trim()

    // ── 管理費 ──────────────────────────────────────────────────────────────
    let managementFee: number | undefined
    document.querySelectorAll('th, dt').forEach(el => {
      if (el.textContent?.includes('管理費')) {
        const next = el.nextElementSibling as HTMLElement
        const fee = parsePriceJpy(next?.textContent ?? '')
        if (fee) managementFee = fee
      }
    })

    // ── 交通 ────────────────────────────────────────────────────────────────
    const transport: string[] = []
    document.querySelectorAll('th, dt').forEach(el => {
      if (el.textContent?.includes('交通')) {
        const next = el.nextElementSibling as HTMLElement
        next?.querySelectorAll('li, p').forEach(item => {
          const t = item.textContent?.trim()
          if (t) transport.push(t)
        })
        if (!transport.length) {
          const t = next?.textContent?.trim()
          if (t) transport.push(t)
        }
      }
    })

    // ── 構造 / 間取り / 設備 ────────────────────────────────────────────────
    const m = buildAthomeMap()
    const findKey = (...keywords: string[]): string => {
      for (const [label, value] of m) {
        if (keywords.some(k => label.includes(k))) return value
      }
      return ''
    }
    const structure = extractStructure(findKey('構造', '建物構造')) || undefined
    const layout = findKey('間取り', '間取') || undefined
    const equipmentText = [
      findKey('設備'),
      findKey('その他', 'その他特記'),
      findKey('特記事項'),
    ].filter(Boolean).join('\n')
    const features = parseFeatures(equipmentText)
    const seismicRetrofit = parseSeismicRetrofit(equipmentText)

    // ── 階数 ────────────────────────────────────────────────────────────────
    const floor = findKey('所在階', '階建') || undefined

    return {
      url: window.location.href,
      platform: 'athome',
      name,
      address,
      price,
      area,
      age,
      floor,
      structure,
      layout,
      seismicRetrofit,
      managementFee,
      transport,
      features,
    }
  } catch (e) {
    console.error('[Bukken.io] athome parse error:', e)
    return null
  }
}

function parsePriceJpy(text: string): number {
  if (!text) return 0
  const clean = text.replace(/[,\s]/g, '')

  const okuMan = clean.match(/(\d+(?:\.\d+)?)億(\d+)万/)
  if (okuMan) return Math.round(parseFloat(okuMan[1]) * 1e8 + parseInt(okuMan[2]) * 1e4)

  const oku = clean.match(/(\d+(?:\.\d+)?)億/)
  if (oku) return Math.round(parseFloat(oku[1]) * 1e8)

  const man = clean.match(/(\d+(?:\.\d+)?)万/)
  if (man) return Math.round(parseFloat(man[1]) * 1e4)

  const num = clean.match(/(\d+)/)
  if (num) return parseInt(num[1])

  return 0
}
