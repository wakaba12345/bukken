/**
 * POST /api/analyze/cemetery
 * ===========================
 * 半径 200m 以内の墓地・霊園検索（台湾人投資家向け事前告知）。
 * 実装は `services/cemeteryCheckService.ts` 参照。
 *
 * リクエスト body:
 *   { address: string } または { lat: number, lng: number }
 *
 * レスポンス: CemeteryCheck（shared/types）
 *   未設定:  501 GOOGLE_KEY_NOT_CONFIGURED
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ApiResponse } from 'shared/types'
import { geocode } from '@/lib/apis/geocode'
import { checkCemeteryNearby } from '@/services/cemeteryCheckService'

export const maxDuration = 30

interface CemeteryRequest {
  address?: string
  lat?: number
  lng?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CemeteryRequest
    const { address } = body
    let { lat, lng } = body

    if (lat == null || lng == null) {
      if (!address) {
        return json({ success: false, error: 'address または lat/lng が必要' }, 400)
      }
      const coords = await geocode(address)
      if (!coords) {
        return json({ success: false, error: 'Geocoding 失敗' }, 404)
      }
      lat = coords.lat
      lng = coords.lng
    }

    const result = await checkCemeteryNearby({ lat, lng })
    if (!result) {
      return json(
        {
          success: false,
          error: 'GOOGLE_MAPS_API_KEY 未設定。files/GOOGLE_API_SETUP.md 参照',
          code: 'GOOGLE_KEY_NOT_CONFIGURED',
        },
        501,
      )
    }

    return json({ success: true, data: result })
  } catch (e) {
    console.error('[/api/analyze/cemetery]', e)
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
