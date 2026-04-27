/**
 * CemeteryCheckService — 半径 200m 以内の墓地・霊園検索
 * =====================================================
 * Google Places API (New) を使用、台湾人投資家への事前告知判断材料を生成。
 *
 * `/api/analyze/cemetery` route と `reportService`（deep_report のみ）から共通利用。
 *
 * リスク分類（vision-prompt.md 準拠）:
 *   🔴 < 50m       高度忌諱
 *   🟠 50-100m    注意
 *   🟡 100-200m   低度影響
 *   🟢 > 200m     影響なし（200m 検索範囲外なら found=false）
 */

import type { CemeteryCheck, CemeteryNearby } from 'shared/types'

interface PlacesNewResponse {
  places?: Array<{
    displayName?: { text?: string; languageCode?: string }
    formattedAddress?: string
    location?: { latitude: number; longitude: number }
  }>
}

export interface CemeteryCheckInput {
  lat: number
  lng: number
}

/**
 * 物件座標の半径 200m 以内に存在する墓地・霊園を検索。
 *
 * @returns CemeteryCheck | null（GOOGLE_MAPS_API_KEY 未設定なら null）
 * @throws Error（Places API 呼出失敗時）
 */
export async function checkCemeteryNearby({
  lat,
  lng,
}: CemeteryCheckInput): Promise<CemeteryCheck | null> {
  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
  if (!GOOGLE_KEY) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[cemeteryCheck] GOOGLE_MAPS_API_KEY 未設定 — skip')
    }
    return null
  }

  // Places API (New) /places:searchNearby、FieldMask で必要フィールドのみ取得
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
          radius: 200,
        },
      },
      languageCode: 'ja',
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Places API failed: ${res.status} ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as PlacesNewResponse
  const places = data.places ?? []

  const cemeteries: CemeteryNearby[] = places
    .filter(p => p.location)
    .map(p => ({
      name: p.displayName?.text ?? '名称不明',
      address: p.formattedAddress,
      distance_m: Math.round(haversineMeters(lat, lng, p.location!.latitude, p.location!.longitude)),
      lat: p.location!.latitude,
      lng: p.location!.longitude,
    }))
    .sort((a, b) => a.distance_m - b.distance_m)

  if (cemeteries.length === 0) {
    return {
      found: false,
      risk_level: '🟢 影響なし',
      nearest_distance_m: null,
      name: null,
      taiwan_buyer_note: '半径 200m 以内に墓地・霊園は確認されませんでした。',
      all_within_200m: [],
      coordinates: { lat, lng },
    }
  }

  const nearest = cemeteries[0]
  const { riskLevel, taiwanBuyerNote } = classifyRisk(nearest.distance_m, nearest.name)

  return {
    found: true,
    risk_level: riskLevel,
    nearest_distance_m: nearest.distance_m,
    name: nearest.name,
    taiwan_buyer_note: taiwanBuyerNote,
    all_within_200m: cemeteries,
    coordinates: { lat, lng },
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
  return {
    riskLevel: '🟡 低度影響',
    taiwanBuyerNote: `「${name}」まで ${distance}m。直接視界には入りにくい距離だが、敏感な買主のため念のため言及するのが望ましい。投資判断への直接的影響は限定的。`,
  }
}

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
