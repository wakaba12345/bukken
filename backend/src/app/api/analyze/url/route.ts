/**
 * POST /api/analyze/url
 * ======================
 * 物件ページの URL を受け取り、HTML を取得して
 * Claude で物件データを抽出する。
 *
 * 主な用途：Chrome 拡張機能なしで URL 入力するウェブ版ユーザー向け。
 * 注意：プラットフォーム側の Bot 対策で取得できない場合は
 *       拡張機能を使うよう案内する。
 *
 * リクエスト: { url: string }
 * レスポンス: PropertyData
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { PropertyData, Platform, ApiResponse } from 'shared/types'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function detectPlatform(url: string): Platform {
  if (url.includes('suumo.jp'))     return 'suumo'
  if (url.includes('athome.co.jp')) return 'athome'
  if (url.includes('homes.co.jp'))  return 'homes'
  return 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { url?: string }
    const { url } = body

    if (!url || !/^https?:\/\/.+/.test(url)) {
      return json({ success: false, error: '有効なURLを入力してください' }, 400)
    }

    const platform = detectPlatform(url)

    // ── ページ取得 ──────────────────────────────────────────────────────────
    let html: string
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.8,en;q=0.5',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(15_000),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = await res.text()
    } catch {
      return json({
        success: false,
        error: 'ページを取得できませんでした。Chrome 拡張機能のご利用をお勧めします。',
      }, 422)
    }

    // ── HTML を整形（スクリプト・スタイル除去、30k 文字上限） ────────────
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 30_000)

    // ── Claude で抽出 ────────────────────────────────────────────────────
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: 'あなたは日本の不動産物件ページのHTML解析専門家です。指定されたJSONのみで回答してください。',
      messages: [
        {
          role: 'user',
          content: `以下は不動産物件ページのHTML（プラットフォーム: ${platform}）です。
物件情報を抽出してJSON形式のみで返してください。見つからない項目はnull。

HTML:
\`\`\`
${cleanHtml}
\`\`\`

JSON（markdownなし）:
{
  "address": "住所（都道府県から）",
  "price": 価格（円・数値のみ）,
  "area": 専有面積（㎡・数値のみ）,
  "age": 築年数（数値のみ）,
  "name": "建物名",
  "floor": "階数（例: 3F/10F）",
  "managementFee": 管理費（円/月・数値のみ）,
  "transport": ["最寄り駅情報1", "最寄り駅情報2"]
}`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      return json({ success: false, error: '物件情報の解析に失敗しました' }, 422)
    }

    if (!extracted.address || !extracted.price) {
      return json({
        success: false,
        error: '物件情報を特定できませんでした。Chrome 拡張機能のご利用をお勧めします。',
      }, 422)
    }

    const propertyData: PropertyData = {
      url,
      platform,
      address: extracted.address as string,
      price: extracted.price as number,
      area: (extracted.area as number) ?? 0,
      age: extracted.age as number | undefined,
      name: extracted.name as string | undefined,
      floor: extracted.floor as string | undefined,
      managementFee: extracted.managementFee as number | undefined,
      transport: extracted.transport as string[] | undefined,
      rawData: extracted,
    }

    return json({ success: true, data: propertyData })
  } catch (e) {
    console.error('[/api/analyze/url]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
