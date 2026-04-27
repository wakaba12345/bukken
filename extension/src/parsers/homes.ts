import type { PropertyData } from '../../../shared/types'
import { extractStructure, parseFeatures, parseSeismicRetrofit } from './featuresHelper'

/**
 * HOME'S 物件ページから情報を抽出する
 * 対象URL例:
 *   https://www.homes.co.jp/mansion/b-XXXXXXXXXX/
 *   https://www.homes.co.jp/kodate/b-XXXXXXXXXX/
 *   https://www.homes.co.jp/chintai/b-XXXXXXXXXX/
 */
export function parseHomes(): PropertyData | null {
  try {
    // ── 価格 ────────────────────────────────────────────────────────────────
    // homes.co.jp は .price や .mod-buyItem などのクラスを使う
    const priceEl =
      document.querySelector('.price-emphasis span') ||
      document.querySelector('.price-emphasis') ||
      document.querySelector('[class*="buyPrice"]') ||
      document.querySelector('.mod-mergeList__data--price') ||
      document.querySelector('td.price') ||
      // テーブルの「販売価格」「価格」セルを探す
      (() => {
        let found: Element | null = null
        document.querySelectorAll('th').forEach(th => {
          if (/^(販売価格|価格|売買価格)$/.test(th.textContent?.trim() ?? '')) {
            found = th.nextElementSibling
          }
        })
        return found
      })()

    const priceText = priceEl?.textContent?.trim() ?? ''
    const price = parsePriceJpy(priceText)
    if (!price) return null

    // ── 住所 ────────────────────────────────────────────────────────────────
    let address = ''

    // パターン1: th/td テーブル
    document.querySelectorAll('th').forEach(th => {
      const label = th.textContent?.trim() ?? ''
      if (/所在地|住所/.test(label) && !address) {
        address = (th.nextElementSibling as HTMLElement)?.textContent?.trim() ?? ''
      }
    })

    // パターン2: dt/dd リスト
    if (!address) {
      document.querySelectorAll('dt').forEach(dt => {
        if (/所在地|住所/.test(dt.textContent?.trim() ?? '') && !address) {
          address = (dt.nextElementSibling as HTMLElement)?.textContent?.trim() ?? ''
        }
      })
    }

    if (!address) return null

    // ── 面積 ────────────────────────────────────────────────────────────────
    let area = 0
    ;[...document.querySelectorAll('th, dt')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/専有面積|建物面積|居住面積/.test(label) && area === 0) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        area = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0
      }
    })

    // ── 築年数 ──────────────────────────────────────────────────────────────
    let age = 0
    ;[...document.querySelectorAll('th, dt')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/築年月|築年数|建築年月|竣工年月/.test(label) && age === 0) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        // 西暦: "2003年3月"
        const seirekiMatch = raw.match(/(\d{4})年/)
        if (seirekiMatch) {
          age = new Date().getFullYear() - parseInt(seirekiMatch[1])
        }
        // 和暦: "平成15年3月" など
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
      document.querySelector('h1.bukkenName')?.textContent?.trim() ||
      document.querySelector('.mod-bukkenName__title')?.textContent?.trim() ||
      document.querySelector('.title-main')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      document.title.split('【')[0].split('｜')[0].trim()

    // ── 管理費 ──────────────────────────────────────────────────────────────
    let managementFee: number | undefined
    ;[...document.querySelectorAll('th, dt')].forEach(el => {
      if (/管理費/.test(el.textContent ?? '') && managementFee === undefined) {
        const raw = (el.nextElementSibling as HTMLElement)?.textContent ?? ''
        const fee = parsePriceJpy(raw)
        if (fee && fee < 200_000) managementFee = fee // 月額上限チェック
      }
    })

    // ── 交通 ────────────────────────────────────────────────────────────────
    const transport: string[] = []
    ;[...document.querySelectorAll('th, dt')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/^(交通|最寄り駅|アクセス)$/.test(label) && transport.length === 0) {
        const td = el.nextElementSibling as HTMLElement
        // li または p 要素を探す
        const items = td?.querySelectorAll('li, p, span.access')
        if (items?.length) {
          items.forEach(item => {
            const text = item.textContent?.trim()
            if (text) transport.push(text)
          })
        } else {
          // テキストを改行で分割
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
    ;[...document.querySelectorAll('th, dt')].forEach(el => {
      const label = el.textContent?.trim() ?? ''
      if (/所在階|階数/.test(label) && !floor) {
        floor = (el.nextElementSibling as HTMLElement)?.textContent?.trim()
      }
    })

    // ── 構造 / 間取り / 設備 ────────────────────────────────────────────────
    const findByLabel = (regex: RegExp): string => {
      let v = ''
      ;[...document.querySelectorAll('th, dt')].forEach(el => {
        const label = el.textContent?.trim() ?? ''
        if (regex.test(label) && !v) {
          v = (el.nextElementSibling as HTMLElement)?.textContent?.trim() ?? ''
        }
      })
      return v
    }
    const structure = extractStructure(findByLabel(/構造|建物構造/)) || undefined
    const layout = findByLabel(/間取り|間取/) || undefined
    const equipmentText = [
      findByLabel(/設備/),
      findByLabel(/その他|特記事項|備考/),
    ].filter(Boolean).join('\n')
    const features = parseFeatures(equipmentText)
    const seismicRetrofit = parseSeismicRetrofit(equipmentText)

    return {
      url: window.location.href,
      platform: 'homes',
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
      transport: transport.filter(Boolean).slice(0, 3),
      features,
    }
  } catch (e) {
    console.error("[Bukken.io] HOME'S parse error:", e)
    return null
  }
}

// ── 価格テキスト → 円（共通ヘルパー） ────────────────────────────────────────
// 例: "6,280万円" → 62800000 / "1億2,000万円" → 120000000

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
