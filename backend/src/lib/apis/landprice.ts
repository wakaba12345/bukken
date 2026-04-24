/**
 * 国土交通省 土地総合情報システム — 不動産取引価格情報取得 API
 *
 * ⚠️ 2026年現在: 旧 domain `www.land.mlit.go.jp` は廃止（DNS 解決不可）。
 * 本サービスは不動産情報ライブラリ（reinfolib）の XPT001 エンドポイントに
 * 統合された。reinfolib の API key 入手後、`reinfolib.ts` 側で再実装する予定。
 *
 * 現状: graceful disabled（呼び出しても常に null）
 */

const BASE_URL = 'https://www.land.mlit.go.jp/webland/api/TradeListSearch'
const SERVICE_DISABLED = true // reinfolib XPT001 に移行まで disable

export interface TradeRecord {
  period: string        // 取引時期 e.g. "2024年第1四半期"
  price: number         // 取引価格（円）
  area: number          // 面積（㎡）
  pricePerSqm: number   // 円/㎡
  floorPlan?: string    // 間取り
  buildingYear?: number // 築年（西暦）
  structure?: string    // 構造（RC・木造など）
  districtName: string  // 地区名
  municipality: string  // 市区町村
  cityPlanning?: string // 用途地域
}

export interface AreaTransactionResult {
  transactions: TradeRecord[]
  avgPricePerSqm: number  // 平均円/㎡
  medianPrice: number     // 中央値（円）
  count: number
  periodFrom: string
  periodTo: string
}

// ── 物件種別コード ────────────────────────────────────────────────────────────
// '01': 宅地(土地)  '02': 宅地(土地と建物)  '03': 中古マンション等
type TradeType = '01' | '02' | '03'

/**
 * 住所周辺の不動産取引価格情報を取得
 * @param address 住所文字列（都道府県から）
 * @param type    物件種別（省略時は '03' = 中古マンション等）
 * @param quartersBack 何四半期分遡るか（省略時は 8 = 2年分）
 */
export async function getNearbyTransactions(
  address: string,
  type: TradeType = '03',
  quartersBack = 8,
): Promise<AreaTransactionResult | null> {
  if (SERVICE_DISABLED) return null
  try {
    const prefCode = extractPrefCode(address)
    if (!prefCode) {
      console.warn('[LandPrice] 都道府県コードを特定できませんでした:', address)
      return null
    }

    const { from, to } = getQuarterRange(quartersBack)

    const url = new URL(BASE_URL)
    url.searchParams.set('type', type)
    url.searchParams.set('area', prefCode)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)

    const res = await fetch(url.toString(), {
      next: { revalidate: 604800 }, // 7日キャッシュ（取引データは四半期更新）
    })

    if (!res.ok) {
      console.error('[LandPrice] API error:', res.status)
      return null
    }

    const json = await res.json()
    if (json.status !== 'OK' || !Array.isArray(json.data)) return null

    // 市区町村名でフィルタリング（住所に含まれる市区町村）
    const cityName = extractCityName(address)
    const filtered = cityName
      ? json.data.filter((d: RawTrade) =>
          d.Municipality && d.Municipality.includes(cityName.replace(/[市区町村郡].*/, ''))
        )
      : json.data

    const records = filtered
      .map(parseTradeRecord)
      .filter((r: TradeRecord | null): r is TradeRecord => r !== null)
      .sort((a: TradeRecord, b: TradeRecord) => b.price - a.price)
      .slice(0, 20) // 最大20件

    if (records.length === 0) return null

    const prices = records.map((r: TradeRecord) => r.price).sort((a: number, b: number) => a - b)
    const sqmPrices = records.map((r: TradeRecord) => r.pricePerSqm).filter((p: number) => p > 0)

    return {
      transactions: records,
      avgPricePerSqm: sqmPrices.length > 0
        ? Math.round(sqmPrices.reduce((s: number, p: number) => s + p, 0) / sqmPrices.length)
        : 0,
      medianPrice: prices[Math.floor(prices.length / 2)] ?? 0,
      count: records.length,
      periodFrom: from,
      periodTo: to,
    }
  } catch (e) {
    console.error('[LandPrice] getNearbyTransactions failed:', e)
    return null
  }
}

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────

interface RawTrade {
  Type?: string
  Municipality?: string
  DistrictName?: string
  TradePrice?: string
  Area?: string
  UnitPrice?: string
  FloorPlan?: string
  BuildingYear?: string
  Structure?: string
  Period?: string
  CityPlanning?: string
}

function parseTradeRecord(d: RawTrade): TradeRecord | null {
  const price = parseInt(d.TradePrice ?? '0', 10)
  const area = parseFloat(d.Area ?? '0')
  if (!price || price <= 0) return null

  // 築年: "昭和63年" / "平成15年" / "2003年" など
  let buildingYear: number | undefined
  if (d.BuildingYear) {
    const seireki = d.BuildingYear.match(/(\d{4})年/)
    if (seireki) {
      buildingYear = parseInt(seireki[1])
    } else {
      const wareki = d.BuildingYear.match(/(昭和|平成|令和)(\d+)年/)
      if (wareki) {
        const base = wareki[1] === '昭和' ? 1925 : wareki[1] === '平成' ? 1988 : 2018
        buildingYear = base + parseInt(wareki[2])
      }
    }
  }

  return {
    period:       d.Period ?? '',
    price,
    area,
    pricePerSqm:  area > 0 ? Math.round(price / area) : parseInt(d.UnitPrice ?? '0', 10),
    floorPlan:    d.FloorPlan || undefined,
    buildingYear,
    structure:    d.Structure || undefined,
    districtName: d.DistrictName ?? '',
    municipality: d.Municipality ?? '',
    cityPlanning: d.CityPlanning || undefined,
  }
}

// YYYYQ 形式の取得範囲を生成
function getQuarterRange(quartersBack: number): { from: string; to: string } {
  const now = new Date()
  const curYear = now.getFullYear()
  const curQ = Math.ceil((now.getMonth() + 1) / 3)

  // 1四半期前を「to」にする（直近は未公表のことが多い）
  let toYear = curYear
  let toQ = curQ - 1
  if (toQ <= 0) { toQ += 4; toYear-- }

  let fromYear = toYear
  let fromQ = toQ - quartersBack + 1
  while (fromQ <= 0) { fromQ += 4; fromYear-- }

  return {
    from: `${fromYear}${fromQ}`,
    to:   `${toYear}${toQ}`,
  }
}

// 住所文字列から都道府県コードを抽出
function extractPrefCode(address: string): string | null {
  const PREF_MAP: Record<string, string> = {
    '北海道': '01', '青森県': '02', '岩手県': '03', '宮城県': '04',
    '秋田県': '05', '山形県': '06', '福島県': '07', '茨城県': '08',
    '栃木県': '09', '群馬県': '10', '埼玉県': '11', '千葉県': '12',
    '東京都': '13', '神奈川県': '14', '新潟県': '15', '富山県': '16',
    '石川県': '17', '福井県': '18', '山梨県': '19', '長野県': '20',
    '岐阜県': '21', '静岡県': '22', '愛知県': '23', '三重県': '24',
    '滋賀県': '25', '京都府': '26', '大阪府': '27', '兵庫県': '28',
    '奈良県': '29', '和歌山県': '30', '鳥取県': '31', '島根県': '32',
    '岡山県': '33', '広島県': '34', '山口県': '35', '徳島県': '36',
    '香川県': '37', '愛媛県': '38', '高知県': '39', '福岡県': '40',
    '佐賀県': '41', '長崎県': '42', '熊本県': '43', '大分県': '44',
    '宮崎県': '45', '鹿児島県': '46', '沖縄県': '47',
  }
  for (const [name, code] of Object.entries(PREF_MAP)) {
    if (address.includes(name)) return code
  }
  return null
}

// 住所から市区町村名を抽出（フィルタリング用）
function extractCityName(address: string): string | null {
  const m = address.match(/(.+?[都道府県])(.+?[市区町村郡])/)
  return m ? m[2] : null
}
