/**
 * POST /api/analyze/amenities
 * ============================
 * 物件周辺のコンビニ（500m）・スーパー（800m）検索 + 賃貸需要評価。
 * 実装は `services/amenitiesCheckService.ts` 参照。
 *
 * リクエスト body:
 *   { address: string } または { lat: number, lng: number }
 *
 * レスポンス: AmenitiesCheck（shared/types）
 *   未設定:  501 GOOGLE_KEY_NOT_CONFIGURED
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ApiResponse } from 'shared/types'
import { geocode } from '@/lib/apis/geocode'
import { checkNearbyAmenities } from '@/services/amenitiesCheckService'

export const maxDuration = 30

interface AmenitiesRequest {
  address?: string
  lat?: number
  lng?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AmenitiesRequest
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

    const result = await checkNearbyAmenities({ lat, lng })
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
    console.error('[/api/analyze/amenities]', e)
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
