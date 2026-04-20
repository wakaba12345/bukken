import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { ApiResponse } from 'shared/types'

// 公開レポートは1時間キャッシュ
export const revalidate = 3600

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const { data, error } = await supabase
      .from('search_results')
      .select(`
        id,
        result_data,
        is_public,
        property_name,
        property_address,
        has_issues,
        issue_count,
        created_at,
        properties (
          price,
          area,
          age,
          platform,
          url
        )
      `)
      .eq('id', id)
      .eq('is_public', true)
      .single()

    if (error || !data) {
      return json({ success: false, error: 'Report not found', code: 'NOT_FOUND' }, 404)
    }

    return json({ success: true, data })
  } catch (e) {
    console.error('[/api/report/[id]]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
