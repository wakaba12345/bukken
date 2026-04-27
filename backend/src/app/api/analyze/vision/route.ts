/**
 * POST /api/analyze/vision
 * =========================
 * Street View 外觀氣場分析（J&E 管理現場視点）。
 * 実装は `services/visionAnalysisService.ts` 参照。
 *
 * リクエスト body:
 *   { address: string } または { lat: number, lng: number }
 *
 * レスポンス: VisionAnalysis（shared/types）
 *   未設定:  501 GOOGLE_KEY_NOT_CONFIGURED
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ApiResponse } from 'shared/types'
import { geocode } from '@/lib/apis/geocode'
import { analyzePropertyVision } from '@/services/visionAnalysisService'

export const maxDuration = 60

interface VisionRequest {
  address?: string
  lat?: number
  lng?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VisionRequest
    const { address } = body
    let { lat, lng } = body

    // 座標解決（国土地理院 geocode を優先）
    if (lat == null || lng == null) {
      if (!address) {
        return json({ success: false, error: 'address または lat/lng が必要です' }, 400)
      }
      const coords = await geocode(address)
      if (!coords) {
        return json({ success: false, error: 'Geocoding 失敗。住所を確認してください' }, 404)
      }
      lat = coords.lat
      lng = coords.lng
    }

    const result = await analyzePropertyVision({ lat, lng })
    if (!result) {
      return json(
        {
          success: false,
          error:
            'GOOGLE_MAPS_API_KEY が未設定です。files/GOOGLE_API_SETUP.md の手順で取得してください。',
          code: 'GOOGLE_KEY_NOT_CONFIGURED',
        },
        501,
      )
    }

    return json({ success: true, data: result })
  } catch (e) {
    console.error('[/api/analyze/vision]', e)
    return json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Internal error',
        code: 'INTERNAL_ERROR',
      },
      500,
    )
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
