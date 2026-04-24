/**
 * J-SHIS Web API — 防災科学技術研究所（国立研究開発法人）
 * https://www.j-shis.bosai.go.jp/api-list
 *
 * 完全無料・申請不要
 * 250mメッシュで地震ハザード情報を提供
 */

const BASE_URL = 'https://www.j-shis.bosai.go.jp/map/api'

// J-SHIS API は確率値を文字列 ("0.090534") で返すことがあるため、数値に正規化する
function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : 0
}

export interface EarthquakeRisk {
  prob30yr5Weak: number    // 30年以内 震度5弱以上の確率 (0-1)
  prob30yr5Strong: number  // 30年以内 震度5強以上の確率 (0-1)
  prob30yr6Weak: number    // 30年以内 震度6弱以上の確率 (0-1)
  prob30yr6Strong: number  // 30年以内 震度6強以上の確率 (0-1)
  meshCode: string
}

/**
 * 座標から地震ハザード情報を取得
 * @param lat 緯度
 * @param lng 経度
 */
export async function getEarthquakeRisk(
  lat: number,
  lng: number,
): Promise<EarthquakeRisk | null> {
  try {
    // J-SHIS API: 確率論的地震動予測地図
    // version=2020, case=AVR (平均モデル), eqcode=ALL
    const url = new URL(`${BASE_URL}/pshm/Y2020/AVR/TTL_MTTL/meshinfo.geojson`)
    url.searchParams.set('position', `${lng},${lat}`)
    url.searchParams.set('epsg', '4326')

    const res = await fetch(url.toString(), {
      next: { revalidate: 2592000 }, // 30日キャッシュ（地震データは頻繁に変わらない）
    })

    if (!res.ok) {
      console.error('[J-SHIS] API error:', res.status)
      return null
    }

    const data = await res.json()

    // レスポンス例:
    // { "features": [{ "properties": {
    //   "T30_I45_PS": 0.999,  // 震度4.5以上（≒5弱以上）30年確率
    //   "T30_I55_PS": 0.982,  // 震度5.5以上（≒6弱以上）30年確率
    //   "T30_I60_PS": 0.876,  // 震度6.0以上（≒6強以上）30年確率
    //   "meshCode": "..."
    // }}]}

    const props = data?.features?.[0]?.properties
    if (!props) return null

    return {
      prob30yr5Weak:   toNum(props['T30_I45_PS']),
      prob30yr5Strong: toNum(props['T30_I50_PS']),
      prob30yr6Weak:   toNum(props['T30_I55_PS']),
      prob30yr6Strong: toNum(props['T30_I60_PS']),
      meshCode:        props['meshCode'] ?? '',
    }
  } catch (e) {
    console.error('[J-SHIS] getEarthquakeRisk failed:', e)
    return null
  }
}

/**
 * メッシュコードから地震ハザード情報を取得（キャッシュ効率が高い）
 */
export async function getEarthquakeRiskByMeshCode(
  meshCode: string,
): Promise<EarthquakeRisk | null> {
  try {
    const url = `${BASE_URL}/pshm/Y2020/AVR/TTL_MTTL/meshinfo.geojson?meshcode=${meshCode}`

    const res = await fetch(url, {
      next: { revalidate: 2592000 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const props = data?.features?.[0]?.properties
    if (!props) return null

    return {
      prob30yr5Weak:   toNum(props['T30_I45_PS']),
      prob30yr5Strong: toNum(props['T30_I50_PS']),
      prob30yr6Weak:   toNum(props['T30_I55_PS']),
      prob30yr6Strong: toNum(props['T30_I60_PS']),
      meshCode,
    }
  } catch (e) {
    console.error('[J-SHIS] getEarthquakeRiskByMeshCode failed:', e)
    return null
  }
}

/**
 * 地震リスクを人間が読めるラベルに変換
 */
export function earthquakeRiskLabel(prob: number, locale: 'ja' | 'zh-TW' = 'ja'): string {
  if (locale === 'zh-TW') {
    if (prob >= 0.9) return '極高風險'
    if (prob >= 0.6) return '高風險'
    if (prob >= 0.3) return '中等風險'
    if (prob >= 0.1) return '低風險'
    return '極低風險'
  }
  if (prob >= 0.9) return '非常に高い'
  if (prob >= 0.6) return '高い'
  if (prob >= 0.3) return '中程度'
  if (prob >= 0.1) return '低い'
  return '非常に低い'
}
