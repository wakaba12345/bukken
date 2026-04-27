/**
 * POST /api/analyze/cemetery
 * ===========================
 * Google Places API (New) で物件半径 200m 以内の墓地・霊園を検索。
 * 台湾人投資家が忌諱する立地条件のチェック（vision-prompt.md 仕様）。
 *
 * リスク分類（vision-prompt.md 準拠）:
 *   🔴 50m 以内       高度忌諱、必ず台湾人買主に告知
 *   🟠 50-100m       注意、告知推奨
 *   🟡 100-200m      低度影響、視認性により案内
 *   🟢 200m 超       影響なし（200m 検索範囲外なら return found=false）
 *
 * リクエスト body:
 *   { address: string } または { lat: number, lng: number }
 *
 * レスポンス:
 *   success: { found, risk_level, nearest_distance_m, name, taiwan_buyer_note,
 *              all_within_200m[], coordinates }
 *   未設定:  501 GOOGLE_KEY_NOT_CONFIGURED
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ApiResponse } from 'shared/types'
import { geocode } from '@/lib/apis/geocode'

export const maxDuration = 30

interface CemeteryRequest {
  address?: string
  lat?: number
  lng?: number
}

interface PlacesNewResponse {
  places?: Array<{
    displayName?: { text?: string; languageCode?: string }
    formattedAddress?: string
    location?: { latitude: number; longitude: number }
  }>
}

export async function POST(req: NextRequest) {
  try {
    const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
    if (!GOOGLE_KEY) {
      return json(
        {
          success: false,
          error: 'GOOGLE_MAPS_API_KEY 未設定。files/GOOGLE_API_SETUP.md 参照',
          code: 'GOOGLE_KEY_NOT_CONFIGURED',
        },
        501,
      )
    }

    const body = (await req.json()) as CemeteryRequest
    const { address } = body
    let { lat, lng } = body

    // 座標解決（国土地理院優先）
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

    // Places API (New) — Nearby Search
    // FieldMask で必要フィールドのみ取得（料金抑制効果あり）
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        includedTypes: ['cemetery'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 200, // m
          },
        },
        languageCode: 'ja',
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[/api/analyze/cemetery] Places API error:', res.status, errText)
      return json(
        { success: false, error: `Places API 失敗: ${res.status}` },
        res.status === 403 ? 502 : 500,
      )
    }

    const data = (await res.json()) as PlacesNewResponse
    const places = data.places ?? []

    // 距離計算（haversine）
    const cemeteries = places
      .filter(p => p.location)
      .map(p => {
        const cLat = p.location!.latitude
        const cLng = p.location!.longitude
        return {
          name: p.displayName?.text ?? '名称不明',
          address: p.formattedAddress,
          distance_m: Math.round(haversineMeters(lat!, lng!, cLat, cLng)),
          lat: cLat,
          lng: cLng,
        }
      })
      .sort((a, b) => a.distance_m - b.distance_m)

    if (cemeteries.length === 0) {
      return json({
        success: true,
        data: {
          found: false,
          risk_level: '🟢 影響なし',
          nearest_distance_m: null,
          name: null,
          taiwan_buyer_note: '半径 200m 以内に墓地・霊園は確認されませんでした。',
          all_within_200m: [],
          coordinates: { lat, lng },
        },
      })
    }

    const nearest = cemeteries[0]
    const { riskLevel, taiwanBuyerNote } = classifyRisk(nearest.distance_m, nearest.name)

    return json({
      success: true,
      data: {
        found: true,
        risk_level: riskLevel,
        nearest_distance_m: nearest.distance_m,
        name: nearest.name,
        taiwan_buyer_note: taiwanBuyerNote,
        all_within_200m: cemeteries,
        coordinates: { lat, lng },
      },
    })
  } catch (e) {
    console.error('[/api/analyze/cemetery]', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return json({ success: false, error: msg, code: 'INTERNAL_ERROR' }, 500)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function classifyRisk(distance: number, name: string): { riskLevel: string; taiwanBuyerNote: string } {
  if (distance < 50) {
    return {
      riskLevel: '🔴 高度忌諱',
      taiwanBuyerNote: `「${name}」が ${distance}m と非常に近接。台湾人買主には事前告知が必須。視認性も含めて誠実に説明し、買主が許容できるか確認すること。`,
    }
  }
  if (distance < 100) {
    return {
      riskLevel: '🟠 注意',
      taiwanBuyerNote: `「${name}」まで ${distance}m。台湾人買主への告知を推奨。物件位置・階数によっては視認可能なため、現地での視認性確認を行い説明資料に含めること。`,
    }
  }
  // 100-200m
  return {
    riskLevel: '🟡 低度影響',
    taiwanBuyerNote: `「${name}」まで ${distance}m。直接視界には入りにくい距離だが、敏感な買主のため念のため言及するのが望ましい。投資判断への直接的影響は限定的。`,
  }
}

/** 2 点間の距離をメートルで返す（haversine 式） */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
