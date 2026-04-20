/**
 * POST /api/analyze/image
 * ========================
 * 間取り図・登記謄本・物件チラシなどの画像から
 * Claude Vision API で物件データを抽出する。
 *
 * リクエスト: multipart/form-data
 *   - image: File (JPEG / PNG / WebP, max 5MB)
 *
 * レスポンス: Partial<PropertyData> + 抽出した追加フィールド
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ApiResponse } from 'shared/types'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type AllowedMediaType = (typeof ALLOWED_TYPES)[number]

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('image') as File | null

    if (!file) {
      return json({ success: false, error: 'image フィールドが必要です' }, 400)
    }

    if (file.size > 5 * 1024 * 1024) {
      return json({ success: false, error: '画像サイズは 5MB 以下にしてください' }, 400)
    }

    const mediaType = (ALLOWED_TYPES.includes(file.type as AllowedMediaType)
      ? file.type
      : 'image/jpeg') as AllowedMediaType

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: 'あなたは日本の不動産資料の解析専門家です。画像から物件情報を正確に抽出します。',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `この画像は日本の不動産物件の資料（間取り図・登記謄本・物件チラシ等）です。
見える情報をすべて抽出してください。見つからない項目は null にしてください。

以下のJSON形式のみで回答（markdownなし）:
{
  "address": "住所（都道府県から番地まで）",
  "price": 価格（円・数値のみ・例: 62800000）,
  "area": 専有面積または建物面積（㎡・数値のみ）,
  "landArea": 土地面積（㎡・数値のみ・一戸建ての場合）,
  "age": 築年数（数値・不明なら建築年から計算）,
  "name": "建物名",
  "floor": "所在階（例: 3F/10F）",
  "managementFee": 管理費（円/月・数値のみ）,
  "structure": "構造（例: RC造・SRC造・木造）",
  "layout": "間取り（例: 3LDK）",
  "landRight": "土地権利（例: 所有権・借地権）",
  "notes": "その他の重要事項"
}`,
            },
          ],
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      return json({ success: false, error: '画像から情報を読み取れませんでした' }, 422)
    }

    if (!extracted.address && !extracted.price) {
      return json({ success: false, error: '物件情報を特定できませんでした。より鮮明な画像をお試しください' }, 422)
    }

    return json({
      success: true,
      data: {
        platform: 'unknown' as const,
        url: '',
        address: (extracted.address as string) ?? '',
        price: (extracted.price as number) ?? 0,
        area: (extracted.area as number) ?? 0,
        age: extracted.age as number | undefined,
        name: extracted.name as string | undefined,
        floor: extracted.floor as string | undefined,
        managementFee: extracted.managementFee as number | undefined,
        rawData: extracted,
      },
    })
  } catch (e) {
    console.error('[/api/analyze/image]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
