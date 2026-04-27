import type { PropertyData } from '../../../shared/types'
import { extractStructure, parseFeatures, parseSeismicRetrofit } from './featuresHelper'

/**
 * SUUMO 物件ページから情報を抽出する
 * 対象URL例:
 *   https://suumo.jp/ms/chuko/tokyo/sc_shibuya/nc_XXXXXXXX/
 *   https://suumo.jp/jj/bukken/shosai/JJ012FD010/?ar=030&bs=021&nc=XXXXXXXX
 */
export function parseSuumo(): PropertyData | null {
  try {
    // SUUMO の物件詳細は <th><div class="fl">ラベル</div></th><td>値</td> 構造
    // ラベル → 値 の map を一度だけ作る
    const tableMap = new Map<string, string>()
    document.querySelectorAll('th').forEach(th => {
      const label = (th.querySelector('.fl')?.textContent ?? th.textContent ?? '').trim()
      const next = th.nextElementSibling as HTMLElement | null
      if (!label || !next || next.tagName !== 'TD') return
      if (!tableMap.has(label)) tableMap.set(label, (next.textContent ?? '').trim())
    })

    const get = (...labels: string[]): string => {
      for (const l of labels) {
        const v = tableMap.get(l)
        if (v) return v
      }
      return ''
    }

    const findByIncludes = (...keywords: string[]): string => {
      for (const [label, value] of tableMap) {
        if (keywords.some(k => label.includes(k))) return value
      }
      return ''
    }

    // ── 価格 ────────────────────────────────────────────────────────────────
    const priceText = get('価格')
    const price = parsePriceJpy(priceText)
    if (!price) return null

    // ── 住所 ────────────────────────────────────────────────────────────────
    const address = get('所在地')
    if (!address) return null

    // ── 面積 ────────────────────────────────────────────────────────────────
    // 「建物面積」は一棟売り/戸建で敷地全体を指すケースがあり、専有面積と混同すると
    // 35,000㎡ 級の異常値が入る。マンション専有面積のみを対象にする。
    const areaText = get('専有面積')
    const areaMatch = areaText.match(/(\d+(?:\.\d+)?)/)
    const area = areaMatch ? parseFloat(areaMatch[1]) : 0

    // ── 築年数 ──────────────────────────────────────────────────────────────
    const ageText = findByIncludes('築年月', '築年数', '完成時期')
    const yearMatch = ageText.match(/(\d{4})年/)
    const age = yearMatch ? new Date().getFullYear() - parseInt(yearMatch[1]) : 0

    // ── 建物名（h1 から価格部分を除去）──────────────────────────────────────
    const rawName = (
      document.querySelector('h1.mainIndexR')?.textContent ||
      document.querySelector('h1')?.textContent ||
      document.title.split('｜')[0]
    )?.trim() ?? ''
    const name = rawName
      .replace(/\s*\d+(?:\.\d+)?億(?:\d+(?:\.\d+)?万)?円.*/u, '')
      .replace(/\s*\d+(?:\.\d+)?万円.*/u, '')
      .replace(/[（(].*?[）)]\s*$/u, '')
      .trim()

    // ── 管理費 ──────────────────────────────────────────────────────────────
    const managementFee = parsePriceJpy(get('管理費')) || undefined

    // ── 交通 ────────────────────────────────────────────────────────────────
    const transportText = get('交通')
    const transport = transportText
      ? transportText.split(/\n|\s{2,}/).map(s => s.trim()).filter(Boolean)
      : []

    // ── 階数 ────────────────────────────────────────────────────────────────
    // 純粋な「所在階」label を優先（中古マンションは「3階」のような単純値）
    // 「所在階/構造・階建」のような結合 label は構造側で使うため避ける
    const floorRaw =
      get('所在階') ||
      get('所在階/構造・階建', '構造・階建て').split('/')[0] ||
      ''
    // 「3階/RC7階建」形式で「3階」だけ抽出
    const floorMatch = floorRaw.match(/(B?\d+階(?:[-〜～]B?\d+階)?)/)
    const floor = floorMatch ? floorMatch[1] : (floorRaw || undefined)

    // ── 構造・間取り ────────────────────────────────────────────────────────
    // SUUMO は「所在階/構造・階建」（中古マンション）or「構造・階建て」（戸建/新築）
    // value 例: "3階/RC7階建" や "RC造11階建"
    const structureRaw =
      get('所在階/構造・階建', '構造・階建て', '構造') ||
      findByIncludes('構造') ||
      ''
    const structure = extractStructure(structureRaw) || undefined
    const layout = get('間取り') || undefined

    // ── 設備（features 抽出） ───────────────────────────────────────────────
    // SUUMO の中古マンションは設備が「その他概要・特記事項」「その他制限事項」など
    // 複数の長い欄位に散る。「その他」を含む全 label の value を結合して解析。
    // ⚠️ findByIncludes('その他') だけだと「その他面積」（バルコニー面積）に
    // マッチして停止し、本来の設備欄を取りこぼす。全 label 走査で対応。
    const equipmentTexts: string[] = []
    for (const [label, value] of tableMap) {
      // 「面積」を含むラベルは設備ではない（その他面積、専有面積、敷地面積等）
      if (/面積/.test(label)) continue
      if (/設備|その他|特記|備考|概要|制限事項/.test(label)) {
        if (value) equipmentTexts.push(value)
      }
    }
    const equipmentText = equipmentTexts.join('\n')
    const features = parseFeatures(equipmentText)
    const seismicRetrofit = parseSeismicRetrofit(equipmentText)

    // dev: tableMap / 抽出結果を console に dump（commit 前に削除）
    if (process.env.NODE_ENV === 'development') {
      console.log('[SUUMO DEBUG v3] tableMap keys:', Array.from(tableMap.keys()))
      console.log('[SUUMO DEBUG v3] structure raw:', structureRaw, '→ extracted:', structure)
      console.log('[SUUMO DEBUG v3] equipmentText (first 800 chars):', equipmentText.slice(0, 800))
      console.log('[SUUMO DEBUG v3] equipmentText source labels:', equipmentTexts.length, 'labels combined')
      console.log('[SUUMO DEBUG v3] parsed features:', features)
      console.log('[SUUMO DEBUG v3] seismicRetrofit:', seismicRetrofit)
    }

    return {
      url: window.location.href,
      platform: 'suumo',
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
