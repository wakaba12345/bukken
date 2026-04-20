import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { deductPoints, supabase } from '@/lib/supabase'
import { generateReport } from '@/services/reportService'
import { POINT_COSTS } from 'shared/types'
import type { FeatureKey, PropertyData, ApiResponse, ReportContent } from 'shared/types'

export const maxDuration = 60 // Vercel Pro: up to 300s

export async function POST(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }

    const { data: { user }, error: authError } = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.getUser(token)

    if (authError || !user) {
      return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }

    // ── Validate request ─────────────────────────────────────────────────────
    const body = await req.json()
    const { property, type } = body as { property: PropertyData; type: FeatureKey }

    if (!property?.address || !type) {
      return json({ success: false, error: 'Invalid request' }, 400)
    }

    const pointCost = POINT_COSTS[type]
    if (!pointCost) {
      return json({ success: false, error: 'Invalid report type' }, 400)
    }

    // ── Upsert property ──────────────────────────────────────────────────────
    const { data: propertyRow, error: propError } = await supabase
      .from('properties')
      .upsert({
        url: property.url,
        platform: property.platform,
        address: property.address,
        lat: property.lat,
        lng: property.lng,
        price: property.price,
        area: property.area,
        age: property.age,
        name: property.name,
        raw_data: property.rawData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'url' })
      .select('id')
      .single()

    if (propError) throw propError

    // ── Deduct points (atomic) ───────────────────────────────────────────────
    try {
      await deductPoints(user.id, pointCost, type, propertyRow.id)
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'INSUFFICIENT_POINTS') {
        return json({
          success: false,
          error: 'Insufficient points',
          code: 'INSUFFICIENT_POINTS',
        }, 402)
      }
      throw e
    }

    // ── Generate report ──────────────────────────────────────────────────────
    let reportContent: ReportContent
    try {
      reportContent = await generateReport(property, type)
    } catch (e) {
      // 生成失敗時はポイントを返還
      await supabase.rpc('add_points', {
        p_user_id: user.id,
        p_points: pointCost,
        p_plan_id: 'refund',
      })
      throw e
    }

    // ── Save report ──────────────────────────────────────────────────────────
    const { data: reportRow, error: reportError } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        property_id: propertyRow.id,
        type: reportContent.type,
        content: reportContent,
        points_used: pointCost,
      })
      .select('id')
      .single()

    if (reportError) throw reportError

    return json({
      success: true,
      data: { ...reportContent, id: reportRow.id },
    })

  } catch (e) {
    console.error('[/api/report/create]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
