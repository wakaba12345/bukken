/**
 * 国土地理院 標高 API
 * ====================
 * 任意の緯度経度から海抜（m）を取得する無料・APIキー不要のエンドポイント。
 *
 * 不動産投資の文脈では：
 *   - 海抜が低い（< 5m）= 津波・高潮・内水氾濫リスク増
 *   - 海抜 ≥ 20m = 内陸高台、水害リスク低
 *   - 周辺との標高差で谷地・崖地の推定も可能（将来実装）
 *
 * Endpoint:
 *   https://cyberjapandata.gsi.go.jp/general/dem/scripts/getelevation.php
 *   ?lon={lng}&lat={lat}&outtype=JSON
 *
 * Response:
 *   { "elevation": 12.5, "hsrc": "DEM5A" }
 *   // データ欠落時は elevation: "-----"
 */

export interface ElevationResult {
  meters: number
  source: string // DEM5A / DEM5B / DEM10B など（精度）
}

export async function getElevation(
  lat: number,
  lng: number,
): Promise<ElevationResult | null> {
  try {
    // 旧 `cyberjapandata.gsi.go.jp` は 2026 時点で /general/dem/scripts/* が S3 NoSuchKey で 404。
    // 新 endpoint は `cyberjapandata2.gsi.go.jp`（数字 2 付き）。
    const url = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`
    const res = await fetch(url, {
      next: { revalidate: 86400 * 30 }, // 30日キャッシュ（標高は変化しない）
    })
    if (!res.ok) return null

    const data = (await res.json()) as { elevation: number | string; hsrc?: string }
    const raw = data.elevation
    const meters = typeof raw === 'number' ? raw : parseFloat(String(raw))
    if (!isFinite(meters)) return null

    return { meters, source: data.hsrc ?? 'GSI' }
  } catch (e) {
    console.error('[Elevation] fetch failed:', e)
    return null
  }
}

/** 標高から水害リスクの定性的コメントを生成（補助） */
export function describeFloodRiskByElevation(meters: number): string {
  if (meters < 0)  return '海面下（ゼロメートル地帯・高潮/浸水リスク極めて高い）'
  if (meters < 3)  return '海抜3m未満（津波/高潮/内水氾濫リスク高）'
  if (meters < 10) return '海抜10m未満（豪雨時の内水氾濫リスクあり）'
  if (meters < 20) return '海抜10〜20m（水害リスク中〜低）'
  return `海抜${Math.round(meters)}m（水害リスク低）`
}

// ─── 坡度（傾斜）解析 ──────────────────────────────────────────────────────

export type SlopeRating = 'flat' | 'gentle' | 'moderate' | 'steep'

export interface SlopeAnalysis {
  center_m: number
  north_m: number
  east_m: number
  south_m: number
  west_m: number
  max_delta_m: number       // 5 点間の最大高低差
  rating: SlopeRating
  note: string
}

/**
 * 物件中心 + 50m 四方向（N/E/S/W）の標高を取得し、坂道の急峻度を判定。
 * 急傾斜は年配・子育て世帯・自転車利用者に敬遠され、賃料天井・入居率に影響する。
 *
 * Rating（max-min 高低差ベース）:
 *   flat:     < 3m   平坦地、生活支障なし
 *   gentle:   3-8m   緩斜面、日常に大きな問題なし
 *   moderate: 8-15m  中傾斜、年配・自転車利用者に負担
 *   steep:    > 15m  急傾斜、強く敬遠（搬入・引越しに支障）
 */
export async function getSlopeAnalysis(
  lat: number,
  lng: number,
): Promise<SlopeAnalysis | null> {
  // 緯度 1 度 ≒ 111km、北緯 35 度の経度 1 度 ≒ 91km
  // → 50m 相当のオフセット = 約 0.00045 度
  const dLat = 0.00045
  const dLng = 0.00055 // 経度方向は若干広め（cos 補正）

  const [center, north, east, south, west] = await Promise.all([
    getElevation(lat, lng),
    getElevation(lat + dLat, lng),
    getElevation(lat, lng + dLng),
    getElevation(lat - dLat, lng),
    getElevation(lat, lng - dLng),
  ])

  if (!center || !north || !east || !south || !west) return null

  const elevs = [center.meters, north.meters, east.meters, south.meters, west.meters]
  const maxDelta = Math.max(...elevs) - Math.min(...elevs)

  let rating: SlopeRating
  let note: string
  if (maxDelta < 3) {
    rating = 'flat'
    note = `平坦地（半径 50m 高低差 ${maxDelta.toFixed(1)}m）。徒歩・自転車利用に支障なし。`
  } else if (maxDelta < 8) {
    rating = 'gentle'
    note = `緩斜面（高低差 ${maxDelta.toFixed(1)}m）。日常生活に大きな支障なし。`
  } else if (maxDelta < 15) {
    rating = 'moderate'
    note = `中程度の斜面（高低差 ${maxDelta.toFixed(1)}m）。年配テナント・自転車利用者に若干の負担。`
  } else {
    rating = 'steep'
    note = `急斜面（高低差 ${maxDelta.toFixed(1)}m）。年配・子育て世帯に強く敬遠される。重い買物・引越し作業に支障、賃料天井・入居率に影響。`
  }

  return {
    center_m: center.meters,
    north_m: north.meters,
    east_m: east.meters,
    south_m: south.meters,
    west_m: west.meters,
    max_delta_m: Math.round(maxDelta * 10) / 10,
    rating,
    note,
  }
}
