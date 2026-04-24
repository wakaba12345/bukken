/**
 * 国土地理院 住所ジオコーディング API
 * https://msearch.gsi.go.jp/address-search/AddressSearch
 *
 * 完全無料・申請不要
 */

export interface Coordinates {
  lat: number
  lng: number
  address: string   // 正規化された住所
}

/**
 * 全角数字・全角ハイフンを半角に変換（日本の住所によくある表記揺れ）
 */
function normalizeAddress(address: string): string {
  return address
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ー−―–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 住所から緯度経度を取得
 */
export async function geocode(address: string): Promise<Coordinates | null> {
  try {
    const normalized = normalizeAddress(address)
    const url = new URL('https://msearch.gsi.go.jp/address-search/AddressSearch')
    url.searchParams.set('q', normalized)

    const res = await fetch(url.toString(), {
      next: { revalidate: 2592000 }, // 30日キャッシュ
    })

    if (!res.ok) {
      console.error('[Geocode] API error:', res.status)
      return null
    }

    const data = await res.json()

    // レスポンス形式:
    // [{ "geometry": { "coordinates": [lng, lat] }, "properties": { "title": "住所" } }]
    if (!Array.isArray(data) || data.length === 0) return null

    const first = data[0]
    const [lng, lat] = first.geometry?.coordinates ?? []

    if (!lat || !lng) return null

    return {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      address: first.properties?.title ?? address,
    }
  } catch (e) {
    console.error('[Geocode] geocode failed:', e)
    return null
  }
}

/**
 * 緯度経度から住所を取得（逆ジオコーディング）
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    // 国土地理院 標高・逆ジオコーディング API
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${lng}&lat=${lat}`

    const res = await fetch(url, {
      next: { revalidate: 2592000 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const result = data?.results

    if (!result) return null

    // 都道府県 + 市区町村 + 町名 を組み合わせる
    const address = [
      result.muniCd ? getPrefecture(result.muniCd.slice(0, 2)) : '',
      result.lv01Nm ?? '',
    ].filter(Boolean).join('')

    return address || null
  } catch (e) {
    console.error('[Geocode] reverseGeocode failed:', e)
    return null
  }
}

// 都道府県コード → 名称
function getPrefecture(code: string): string {
  const map: Record<string, string> = {
    '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県',
    '05': '秋田県', '06': '山形県', '07': '福島県', '08': '茨城県',
    '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県',
    '13': '東京都', '14': '神奈川県', '15': '新潟県', '16': '富山県',
    '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県',
    '21': '岐阜県', '22': '静岡県', '23': '愛知県', '24': '三重県',
    '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
    '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県',
    '33': '岡山県', '34': '広島県', '35': '山口県', '36': '徳島県',
    '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県',
    '41': '佐賀県', '42': '長崎県', '43': '熊本県', '44': '大分県',
    '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県',
  }
  return map[code] ?? ''
}
