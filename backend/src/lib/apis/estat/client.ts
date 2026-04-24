/**
 * e-Stat API 共用 client
 * =========================
 * getStatsData / getStatsList をラップし、環境設定・共通エラーハンドリング・
 * キャッシュ設定を一元化する。各統計モジュール（population, housing, etc）から
 * 使用される。
 */

export const ESTAT_APP_ID = process.env.ESTAT_APP_ID
export const BASE_URL = 'https://api.e-stat.go.jp/rest/3.0/app/json'

export function isEstatEnabled(): boolean {
  return !!ESTAT_APP_ID
}

// ─── Response 型 ──────────────────────────────────────────────────────────

export interface EStatValue {
  '@tab'?: string
  '@cat01'?: string
  '@cat02'?: string
  '@cat03'?: string
  '@cat04'?: string
  '@cat05'?: string
  '@area'?: string
  '@time'?: string
  '@unit'?: string
  '$': string
}

export interface EStatDataResponse {
  GET_STATS_DATA?: {
    RESULT?: { STATUS: number; ERROR_MSG?: string }
    STATISTICAL_DATA?: {
      TABLE_INF?: { TITLE?: { '$': string } | string }
      DATA_INF?: { VALUE?: EStatValue[] | EStatValue }
    }
  }
}

// ─── コア API ────────────────────────────────────────────────────────────

/**
 * getStatsData エンドポイント呼び出し。
 * APP_ID 未設定時は null、それ以外のエラーは console.error 後に null。
 *
 * @param statsDataId 対象の統計表 ID（e-Stat 公開データから選定）
 * @param params      他のクエリ（cdArea, cdCat01, cdTime, 等）
 * @param revalidate  Next.js fetch cache seconds（default 30日、国勢調査等の低頻度データ向け）
 */
export async function fetchStatsData(
  statsDataId: string,
  params: Record<string, string> = {},
  revalidate = 86400 * 30,
): Promise<EStatDataResponse | null> {
  if (!ESTAT_APP_ID) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[e-Stat] ESTAT_APP_ID not set — skipping')
    }
    return null
  }
  try {
    const qs = new URLSearchParams({
      appId: ESTAT_APP_ID,
      statsDataId,
      ...params,
    })
    const res = await fetch(`${BASE_URL}/getStatsData?${qs}`, {
      next: { revalidate },
    })
    if (!res.ok) return null
    const json = (await res.json()) as EStatDataResponse
    const status = json.GET_STATS_DATA?.RESULT?.STATUS
    if (status !== 0 && status !== 1) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[e-Stat] ${statsDataId} STATUS=${status} ${json.GET_STATS_DATA?.RESULT?.ERROR_MSG ?? ''}`)
      }
      return null
    }
    return json
  } catch (e) {
    console.error('[e-Stat] fetchStatsData failed:', e)
    return null
  }
}

/** response から VALUE 配列を安全に取得 */
export function getValues(resp: EStatDataResponse | null): EStatValue[] {
  const v = resp?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/** 数値化ヘルパー（"260486" → 260486、失敗時 undefined） */
export function toNumber(s: string | undefined): number | undefined {
  if (!s) return undefined
  const n = parseFloat(s.replace(/,/g, ''))
  return isFinite(n) ? n : undefined
}
