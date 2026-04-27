/**
 * Property features / structure 抽出 — 全 parser 共通
 * =====================================================
 * 日本の不動産ポータルの設備テキスト（自然言語）から PropertyFeatures を抽出。
 * 明示されていない項目は undefined のまま（「データなし」と「実際にない」を区別）。
 */

import type { PropertyFeatures } from '../../../shared/types'

/**
 * 「構造・階建て」テキストから構造名を抽出。
 * SUUMO は「3階/RC7階建」のように「造」を省略するため、両方サポート。
 *
 * 出力は正規化された「○○造」形式:
 *   "RC造11階建" → "RC造"
 *   "3階/RC7階建" → "RC造"      （SUUMO 中古マンション形式）
 *   "鉄骨造3階建" → "鉄骨造"
 *   "木造2階建" → "木造"
 */
export function extractStructure(text: string): string {
  if (!text) return ''
  // 順序重要：「造」付き / 長い表記を先に試す
  const patterns: Array<[RegExp, string]> = [
    [/SRC造/, 'SRC造'],
    [/鉄骨鉄筋コンクリート造?/, 'SRC造'],
    [/RC造/, 'RC造'],
    [/鉄筋コンクリート造?/, 'RC造'],
    [/軽量鉄骨造?/, '軽量鉄骨造'],
    [/重量鉄骨造?/, '重量鉄骨造'],
    [/鉄骨造/, '鉄骨造'],
    [/木造/, '木造'],
    [/プレキャスト/, 'プレキャスト'],
    [/ALC造?/, 'ALC造'],
    [/ブロック造/, 'ブロック造'],
    // 「造」省略形（SUUMO 中古マンション「RC7階建」形式）— 最後にチェック
    [/\bSRC\b/, 'SRC造'],
    [/\bRC\b/, 'RC造'],
    [/\b鉄骨\b/, '鉄骨造'],
  ]
  for (const [re, normalized] of patterns) {
    if (re.test(text)) return normalized
  }
  return ''
}

/**
 * 設備テキストから PropertyFeatures を抽出。
 * 入力は複数欄位を結合した文字列でも OK（「設備」「その他」「特記事項」等）。
 */
export function parseFeatures(text: string): PropertyFeatures | undefined {
  if (!text) return undefined
  const f: PropertyFeatures = {}

  // autolock
  if (/オートロック/.test(text)) f.autolock = true

  // バス・トイレ別 / 一体
  if (/バス・?トイレ別|セパレート/.test(text)) f.bathToiletSeparate = true
  else if (/3点ユニット|ユニットバス|バス・?トイレ同室/.test(text)) f.bathToiletSeparate = false

  // バルコニー
  if (/バルコニー|テラス|ルーフバルコニー/.test(text)) f.balcony = true

  // 洗濯機室内設置
  if (/室内洗濯機置場|洗濯機置場.*室内|屋内洗濯機|室内.*洗濯/.test(text)) f.washerIndoor = true
  else if (/共用洗濯|屋外洗濯|ベランダ洗濯/.test(text)) f.washerIndoor = false

  // 浴槽（シャワーのみ明示なら false、浴槽明示なら true、不明なら undefined）
  if (/シャワーのみ|シャワールーム(?!.*浴槽)/.test(text)) f.bathtub = false
  else if (/浴槽|バスタブ|追焚|追い焚き|オートバス|風呂/.test(text)) f.bathtub = true

  return Object.keys(f).length > 0 ? f : undefined
}

/**
 * 設備・特記事項テキストから「耐震補強済」かどうかを判定。
 * 旧耐震物件（築 44 年以上）で補強済かは融資審査・買主敬遠度に大きく影響する。
 *
 * 明示的に補強済と書かれていれば true、不明なら undefined。
 */
export function parseSeismicRetrofit(text: string): boolean | undefined {
  if (!text) return undefined
  if (/耐震補強(工事)?済|補強工事済|耐震改修済|耐震診断済|新耐震(基準)?適合/.test(text)) return true
  return undefined
}
