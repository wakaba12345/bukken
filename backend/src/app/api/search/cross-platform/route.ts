/**
 * クロスプラットフォーム検索オーケストレーター
 * =============================================
 * 外掛（ブラウザ内）から受け取った物件データを基に、
 * 複数の情報源を並列で検索・統合する。
 *
 * アーキテクチャ：
 *   外掛（第一層）→ このAPI →  第二層（政府API）
 *                           →  第三層（Google拡大検索）
 *                           →  落差分析エンジン
 *                           →  Claude AI統合分析
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeCrossPlatform } from '@/services/discrepancyAnalyzer'
import { runLayer3Search, extractArea } from '@/services/layer3Search'
import { getEarthquakeRisk } from '@/lib/apis/jshis'
import { getDisasterRisk } from '@/lib/apis/reinfolib'
import { getAreaMarket } from '@/lib/apis/fudosandb'
import { geocode } from '@/lib/apis/geocode'
import { checkOshimaland } from '@/lib/apis/oshimaland'
import { supabase } from '@/lib/supabase'
import type { PropertyData, ApiResponse } from 'shared/types'
import type { PlatformMatch } from '@/services/discrepancyAnalyzer'

export const maxDuration = 60

// ─── リクエスト型 ─────────────────────────────────────────────────────────────

interface CrossSearchRequest {
  /** 外掛が抽出した現在ページの物件データ（第一層） */
  source: PropertyData
  /** 外掛が既に見つけた他プラットフォームのデータ（任意） */
  knownMatches?: PlatformMatch[]
}

// ─── API ルート ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CrossSearchRequest
    const { source, knownMatches = [] } = body

    if (!source?.address) {
      return json({ success: false, error: 'Missing address' }, 400)
    }

    // ── 座標取得（全ての地理系APIに必要） ─────────────────────────────────────
    let lat = source.lat
    let lng = source.lng
    if (!lat || !lng) {
      const coords = await geocode(source.address)
      lat = coords?.lat
      lng = coords?.lng
    }

    const area = extractArea(source.address)
    const buildingName = source.name

    // ── 全ての情報源を並列取得 ─────────────────────────────────────────────────
    const [
      earthquakeRisk,
      disasterRisk,
      areaMarket,
      oshimaResult,
      layer3Result,
    ] = await Promise.allSettled([
      lat && lng ? getEarthquakeRisk(lat, lng) : Promise.resolve(null),
      lat && lng ? getDisasterRisk(lat, lng) : Promise.resolve(null),
      lat && lng ? getAreaMarket(source.address, lat, lng, source.area, source.age) : Promise.resolve(null),
      checkOshimaland({
        address: source.address,
        floor: source.floor,
        propertyType: detectPropertyType(source),
      }),
      runLayer3Search({ buildingName, address: source.address, area }),
    ])

    // ── 落差分析 ───────────────────────────────────────────────────────────────
    const crossAnalysis = analyzeCrossPlatform(source, knownMatches)

    // ── 結果を Supabase に保存（永久URL用） ─────────────────────────────────────
    const reportId = await saveSearchResult({
      source,
      crossAnalysis,
      earthquakeRisk: earthquakeRisk.status === 'fulfilled' ? earthquakeRisk.value : null,
      disasterRisk: disasterRisk.status === 'fulfilled' ? disasterRisk.value : null,
      areaMarket: areaMarket.status === 'fulfilled' ? areaMarket.value : null,
      oshima: oshimaResult.status === 'fulfilled' ? oshimaResult.value : null,
      layer3: layer3Result.status === 'fulfilled' ? layer3Result.value : null,
    })

    return json({
      success: true,
      data: {
        reportId,
        shareUrl: `https://bukken.io/report/${reportId}`,
        crossAnalysis,
        earthquakeRisk: earthquakeRisk.status === 'fulfilled' ? earthquakeRisk.value : null,
        disasterRisk: disasterRisk.status === 'fulfilled' ? disasterRisk.value : null,
        areaMarket: areaMarket.status === 'fulfilled' ? areaMarket.value : null,
        oshima: oshimaResult.status === 'fulfilled' ? oshimaResult.value : null,
        layer3: layer3Result.status === 'fulfilled' ? layer3Result.value : null,
      },
    })
  } catch (e) {
    console.error('[/api/search/cross-platform]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

// ─── 物件種別判定 ─────────────────────────────────────────────────────────────

function detectPropertyType(property: PropertyData): 'mansion' | 'house' {
  const name = (property.name ?? '').toLowerCase()
  const mansionKeywords = ['マンション', 'レジデンス', 'タワー', 'コート', 'ハイツ', 'パレス', 'ガーデン']
  const houseKeywords = ['一戸建て', '一軒家', '戸建', '土地']

  if (houseKeywords.some(k => name.includes(k))) return 'house'
  if (mansionKeywords.some(k => name.includes(k))) return 'mansion'

  // 階数があればマンション
  if (property.floor) return 'mansion'

  return 'mansion' // デフォルト
}

// ─── 結果保存 ─────────────────────────────────────────────────────────────────

async function saveSearchResult(data: Record<string, unknown>): Promise<string> {
  try {
    // まず物件をupsert
    const source = data.source as PropertyData
    const { data: propRow } = await supabase
      .from('properties')
      .upsert({
        url: source.url,
        platform: source.platform,
        address: source.address,
        price: source.price,
        area: source.area,
        age: source.age,
        name: source.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'url' })
      .select('id')
      .single()

    // search_resultsテーブルに保存
    const { data: resultRow } = await supabase
      .from('search_results')
      .insert({
        property_id: propRow?.id,
        result_data: data,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    return resultRow?.id ?? generateFallbackId()
  } catch {
    return generateFallbackId()
  }
}

function generateFallbackId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
