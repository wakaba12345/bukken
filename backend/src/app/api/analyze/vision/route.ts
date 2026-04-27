/**
 * POST /api/analyze/vision
 * =========================
 * 物件の Street View 画像（3 視角）を Google Maps から取得し、
 * Claude Vision API で「J&E 管理現場視点」の外観気場分析を行う。
 *
 * 評估框架：垃圾堆放区 / 陽台 / 外壁 / 共用部 / 信箱 / 駐輪場 / 採光 / 周辺環境
 * Prompt 仕様詳細は プロジェクトルートの `bukken-vision-prompt.md` 参照。
 *
 * ⚠️ 現状「骨架」段階：
 *   - GOOGLE_MAPS_API_KEY 未設定なら 501 を返す
 *   - Key 申請手順は `files/GOOGLE_API_SETUP.md` 参照
 *   - 座標解決は 国土地理院 geocode を優先使用（Google Geocoding クォータ節約）
 *   - Street View 画像は backend で fetch → base64 で Claude に渡す
 *     （理由：Anthropic Vision の URL fetch は Google robots.txt に拒否される。
 *      副次効果：Google API key が Anthropic に漏れない）
 *
 * リクエスト body:
 *   { address: string } または { lat: number, lng: number }（address 優先で座標取得）
 *
 * レスポンス:
 *   success: { overall_score, risk_level, summary, details, red_flags, green_flags,
 *              management_advice, streetViewUrls, coordinates }
 *   未設定:  501 GOOGLE_KEY_NOT_CONFIGURED
 */

import { NextRequest, NextResponse } from 'next/server'
import { tmpdir } from 'os'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { ApiResponse } from 'shared/types'
import { geocode } from '@/lib/apis/geocode'

export const maxDuration = 60

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 5,
})

// ─── Prompt 定義（bukken-vision-prompt.md と同期）──────────────────────────

const SYSTEM_PROMPT = `あなたは 10 年以上の実務経験を持つ日本の不動産管理会社の専門家です。外観写真から物件の管理状況と住民の素質を判断します。判断基準は台湾人投資家の実際の管理経験に基づき、以下の観点を特に重視します：住民の共用空間に対する態度、マンション管理組合の修繕意欲、そして台湾人投資家が特に気にする風水・環境要因。

提供された写真に基づき、構造化された「物件気場評価レポート」を JSON で出力してください。見えない項目は null にしてください。フェイクデータは絶対に作らないこと。

【重要な判断ルール — 植栽について】
- 緑が茂っている／植栽が繁茂しているのは住民の手入れが行き届いている健康なサイン。red_flag として扱わないこと
- red_flag とすべきは「枯れた植物」「腐敗した植栽」「雑物の堆積」のみ
- 「植栽繁茂を気の滞り／入口の気の遮断」として警戒視するのは誤った風水解釈なので避ける（J&E 管理現場の判断基準では緑の手入れは加点要素）

【重要な判断ルール — 風水視点の中日差異】
中華圏（台湾・中国）の風水概念と日本の不動産実務の評価基準は異なる。以下に該当するものは **日本の不動産投資判断としての red_flag に挙げないこと**：
- 路沖（道路が玄関に正面突き当たる）
- 線路煞（電線・電柱の近接）
- 反弓煞、天斬煞 等の煞気概念
- 「気の散逸」「気の滞り」「気の流れ」関連の判断

特に **「永久棟距」（道路を挟んで向かい側に建物がない）は日本では加点要素**：
- 採光・通風が確保される
- 将来高層建物が建つリスクが低い
- 視界の開放感が住居快適性を上げる

中華圏の風水に該当する事項は、red_flag ではなく **management_advice** で「台湾人投資家への事前説明事項」として補足記載するに留めること。

red_flag に挙げるべき日本の実務的立地リスクは以下のみ：
- 高架道路の真下
- 線路至近距離（騒音・振動）
- 工場・墓地・嫌悪施設（風俗店、パチンコ等）の隣接
- 軟弱地盤、洪水想定区域内
- 異常な高圧送電鉄塔の真下（雷リスク・電磁波懸念）`

const USER_PROMPT = `以下は物件の Street View 写真です。評估框架に従い逐項分析し、指定 JSON 形式で結果を出力してください。

### 評估框架

#### 1. 垃圾堆放区
- 可見か、整齊程度（整齊 / 稍亂 / 明顯堆出來）、風險等級（綠/黃/橘/紅）

#### 2. 陽台（可見な陽台ごとに評価）
- 雜物堆放 / 枯植物（**高リスクシグナル：住民精神状態懸念**）
- 衣物過多曝曬（多人同住の可能性）/ 整體印象

#### 3. 外壁・建物
- 磁磚掉落/裂縫（管理組合の修繕意欲不足の兆候）
- 塗鴉未清除 / 維護状況（良好/普通/老化/失修）

#### 4. 共用部
- 走廊/門廊に小装飾の有無（**加分項：住民の空間帰属感**）
- 個人物品堆放 / 整體印象

#### 5. 信箱区
- 整齊乾淨 / 広告の堆積量（無/少量/大量 — **大量=高空室率の可能性**）
- 破損有無

#### 6. 駐輪場
- 整齊程度 / 廃棄車両有無

#### 7. 採光
- 物件朝向 / 周辺建物の相対的高さ / 採光評価

#### 8. 周辺環境
- 街道整潔度 / 周辺氛囲（高級/一般/商住混合/老舊）/ 異常施設

---

### 出力 JSON 形式（markdown なしの JSON のみ）

{
  "overall_score": 0-100,
  "risk_level": "低風險 / 注意 / 警示 / 高風險",
  "summary": "2-3 文で物件の気場を管理会社視点で総括",
  "details": {
    "garbage_area": { "visible": bool, "condition": "整齊/稍亂/明顯堆出來", "risk": "綠/黃/橘/紅", "note": "" },
    "balconies": { "hoarding": bool, "dead_plants": bool, "excessive_laundry": bool, "risk": "綠/黃/橘/紅", "note": "" },
    "exterior": { "tile_damage": bool, "graffiti": bool, "condition": "良好/普通/老化/失修", "note": "" },
    "common_area": { "decorations": bool, "personal_items": bool, "risk": "綠/黃/橘/紅", "note": "" },
    "mailbox_area": { "visible": bool, "clean": bool, "ad_accumulation": "無/少量/大量", "damaged": bool, "note": "" },
    "bicycle_parking": { "visible": bool, "condition": "整齊/普通/凌亂", "abandoned_bikes": bool, "note": "" },
    "sunlight": { "direction": "", "surrounding_height": "低/相近/高", "rating": "優/良/普通/差", "note": "" },
    "environment": { "street_cleanliness": "整潔/普通/髒亂", "area_type": "", "note": "" }
  },
  "red_flags": ["高リスクシグナル全て"],
  "green_flags": ["加分項全て"],
  "management_advice": "J&E 管理会社視点：この物件を引き受けるなら特に注意すべき点"
}`

// ─── Route ────────────────────────────────────────────────────────────────

interface VisionRequest {
  address?: string
  lat?: number
  lng?: number
}

export async function POST(req: NextRequest) {
  try {
    const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
    if (!GOOGLE_KEY) {
      return json(
        {
          success: false,
          error:
            'GOOGLE_MAPS_API_KEY が未設定です。files/GOOGLE_API_SETUP.md の手順で取得し、backend/.env.local に追加してください。',
          code: 'GOOGLE_KEY_NOT_CONFIGURED',
        },
        501,
      )
    }

    const body = (await req.json()) as VisionRequest
    const { address } = body
    let { lat, lng } = body

    // 座標解決（国土地理院 geocode を優先 — Google Geocoding クォータ節約）
    if (lat == null || lng == null) {
      if (!address) {
        return json(
          { success: false, error: 'address または lat/lng が必要です' },
          400,
        )
      }
      const coords = await geocode(address)
      if (!coords) {
        return json({ success: false, error: 'Geocoding 失敗。住所を確認してください' }, 404)
      }
      lat = coords.lat
      lng = coords.lng
    }

    // Street View URL を 3 角度生成（heading 0, 90, 180）
    const streetViewUrls = [0, 90, 180].map(heading => {
      const u = new URL('https://maps.googleapis.com/maps/api/streetview')
      u.searchParams.set('size', '640x640')
      u.searchParams.set('location', `${lat},${lng}`)
      u.searchParams.set('heading', String(heading))
      u.searchParams.set('pitch', '0')
      u.searchParams.set('fov', '90')
      u.searchParams.set('key', GOOGLE_KEY)
      return u.toString()
    })

    // backend で画像を fetch → base64 化（Anthropic 側 URL fetch は robots.txt で拒否される）
    const images = await Promise.all(
      streetViewUrls.map(async url => {
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Street View fetch failed: ${res.status} ${res.statusText}`)
        }
        const contentType = res.headers.get('content-type') ?? ''
        if (!contentType.startsWith('image/')) {
          throw new Error(`Unexpected content-type: ${contentType}`)
        }
        const buf = Buffer.from(await res.arrayBuffer())
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: (contentType.split(';')[0] as 'image/jpeg' | 'image/png'),
            data: buf.toString('base64'),
          },
        }
      }),
    )

    // dev only: 取得した画像を OS temp に保存（debug / 確認用）
    if (process.env.NODE_ENV === 'development') {
      try {
        const dir = join(tmpdir(), 'bukken-vision')
        await mkdir(dir, { recursive: true })
        const ts = Date.now()
        const paths = await Promise.all(
          images.map(async (img, i) => {
            const headings = [0, 90, 180]
            const p = join(dir, `streetview_${ts}_h${headings[i]}.jpg`)
            await writeFile(p, Buffer.from(img.source.data, 'base64'))
            return p
          }),
        )
        console.log('[/api/analyze/vision] dev image dump:')
        paths.forEach(p => console.log('  -', p))
      } catch (e) {
        console.warn('[/api/analyze/vision] dev image dump failed:', e)
      }
    }

    // Claude Vision 呼び出し
    // memory の feedback_claude_model.md ルール：backend API model は固定で claude-sonnet-4-6
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      // 8 面向 details + summary + flags + advice の出力には 2000 tokens では不足
      // （実測: 2000 で stop_reason=max_tokens、JSON 途切れる）
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...images,
            { type: 'text' as const, text: USER_PROMPT },
          ],
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    if (process.env.NODE_ENV === 'development') {
      console.log('[/api/analyze/vision] raw response (first 500 chars):', text.slice(0, 500))
      console.log('[/api/analyze/vision] stop_reason:', response.stop_reason, 'usage:', response.usage)
    }

    let analysis: Record<string, unknown>
    try {
      analysis = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch (parseError) {
      return json(
        {
          success: false,
          error: `Vision 分析結果の JSON 解析に失敗しました: ${parseError instanceof Error ? parseError.message : 'unknown'}`,
        },
        500,
      )
    }

    // ⚠️ streetViewUrls には GOOGLE_MAPS_API_KEY が含まれるため response に含めない。
    // 前端で Street View 画像を表示する場合は別途 proxy endpoint を実装すること。
    return json({
      success: true,
      data: {
        ...analysis,
        coordinates: { lat, lng },
      },
    })
  } catch (e) {
    console.error('[/api/analyze/vision]', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return json({ success: false, error: msg, code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
