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
