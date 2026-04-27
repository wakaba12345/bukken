/**
 * AmenitiesCheckService — 便利商店・超市の近接度チェック
 * ========================================================
 * Google Places API (New) で物件周辺のコンビニ（半径 500m）と
 * スーパー（半径 800m）を検索、賃貸需要への影響を判定する。
 *
 * J&E 管理現場視点：
 *   コンビニ徒歩圏（5分以内 = 約 400m）と週次買い出しスーパー（徒歩 10 分以内 = 約 800m）
 *   の有無は、特に単身・共働き世帯の入居判断に直接影響する。
 *
 * Rating:
 *   excellent: コンビニ ≥3（300m 内） & スーパー ≥1（500m 内）
 *   good:      コンビニ ≥1（500m 内） & スーパー ≥1（800m 内）
 *   limited:   コンビニ or スーパーいずれか（800m 内）
 *   poor:      800m 内に施設なし
 */

import type { AmenitiesCheck, AmenitiesRating, NearbyAmenity } from 'shared/types'

interface PlacesNewResponse {
  places?: Array<{
    displayName?: { text?: string }
    formattedAddress?: string
    location?: { latitude: number; longitude: number }
  }>
}

export interface AmenitiesCheckInput {
  lat: number
  lng: number
}

/**
 * 物件座標周辺のコンビニ・スーパーを検索し、賃貸需要への影響を評価。
 *
 * @returns AmenitiesCheck | null（GOOGLE_MAPS_API_KEY 未設定なら null）
 * @throws Error（Places API 呼出失敗時）
 */
export async function checkNearbyAmenities({
  lat,
  lng,
}: AmenitiesCheckInput): Promise<AmenitiesCheck | null> {
  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
  if (!GOOGLE_KEY) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[amenitiesCheck] GOOGLE_MAPS_API_KEY 未設定 — skip')
    }
    return null
  }

  // 並列で 2 種類の施設を検索
  const [conv, sup] = await Promise.all([
    fetchPlaces(GOOGLE_KEY, lat, lng, 'convenience_store', 500),
    fetchPlaces(GOOGLE_KEY, lat, lng, 'supermarket', 800),
  ])

  const convenience_stores: NearbyAmenity[] = conv
    .map(p => toNearby(p, lat, lng, 'convenience_store'))
    .filter((p): p is NearbyAmenity => p !== null)
    .sort((a, b) => a.distance_m - b.distance_m)

  const supermarkets: NearbyAmenity[] = sup
    .map(p => toNearby(p, lat, lng, 'supermarket'))
    .filter((p): p is NearbyAmenity => p !== null)
    .sort((a, b) => a.distance_m - b.distance_m)

  const nearestConv = convenience_stores[0]?.distance_m ?? null
  const nearestSup = supermarkets[0]?.distance_m ?? null

  const { rating, ratingNote } = classify(convenience_stores, supermarkets)

  return {
    convenience_stores,
    supermarkets,
    nearest_convenience_m: nearestConv,
    nearest_supermarket_m: nearestSup,
    rating,
    rating_note: ratingNote,
    coordinates: { lat, lng },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function fetchPlaces(
  apiKey: string,
  lat: number,
  lng: number,
  type: 'convenience_store' | 'supermarket',
  radius: number,
): Promise<NonNullable<PlacesNewResponse['places']>> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      includedTypes: [type],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      },
      languageCode: 'ja',
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Places API failed (${type}): ${res.status} ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as PlacesNewResponse
  return data.places ?? []
}

function toNearby(
  p: NonNullable<PlacesNewResponse['places']>[number],
  lat: number,
  lng: number,
  type: 'convenience_store' | 'supermarket',
): NearbyAmenity | null {
  if (!p.location) return null
  return {
    type,
    name: p.displayName?.text ?? '名称不明',
    address: p.formattedAddress,
    distance_m: Math.round(haversineMeters(lat, lng, p.location.latitude, p.location.longitude)),
    lat: p.location.latitude,
    lng: p.location.longitude,
  }
}

function classify(
  convs: NearbyAmenity[],
  sups: NearbyAmenity[],
): { rating: AmenitiesRating; ratingNote: string } {
  const convsIn300 = convs.filter(c => c.distance_m <= 300).length
  const convsIn500 = convs.filter(c => c.distance_m <= 500).length
  const supsIn500 = sups.filter(s => s.distance_m <= 500).length
  const supsIn800 = sups.filter(s => s.distance_m <= 800).length

  if (convsIn300 >= 3 && supsIn500 >= 1) {
    return {
      rating: 'excellent',
      ratingNote: `コンビニ徒歩 4 分圏内に ${convsIn300} 軒、スーパー徒歩 6 分圏内に ${supsIn500} 軒。賃貸需要を強力に下支え、特に単身・共働き世帯から高評価。`,
    }
  }
  if (convsIn500 >= 1 && supsIn800 >= 1) {
    return {
      rating: 'good',
      ratingNote: `コンビニ徒歩 6 分圏内 ${convsIn500} 軒、スーパー徒歩 10 分圏内 ${supsIn800} 軒。日常生活に十分な利便性。`,
    }
  }
  if (convsIn500 + supsIn800 >= 1) {
    return {
      rating: 'limited',
      ratingNote: `生活利便施設が限定的（コンビニ 500m 内 ${convsIn500} 軒、スーパー 800m 内 ${supsIn800} 軒）。徒歩圏での日常買物に難あり、賃料設定の上限要因となる可能性。`,
    }
  }
  return {
    rating: 'poor',
    ratingNote: '徒歩圏（800m 内）にコンビニ・スーパーともに確認できず。生活利便性が大きく劣り、賃貸需要・賃料水準に重大なマイナス要因。',
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
