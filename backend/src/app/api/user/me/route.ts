import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, ApiResponse } from 'shared/types'

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const { data: { user }, error } = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.getUser(token)

    if (error || !user) {
      return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }

    // プロフィールと残高を並列取得
    const [profileRes, accountRes] = await Promise.all([
      supabase.from('user_profiles').select('locale').eq('id', user.id).single(),
      supabase.from('point_accounts').select('balance').eq('user_id', user.id).single(),
    ])

    const profile: UserProfile = {
      id: user.id,
      email: user.email ?? '',
      locale: (profileRes.data?.locale as 'ja' | 'zh-TW') ?? 'ja',
      pointBalance: accountRes.data?.balance ?? 0,
      createdAt: user.created_at,
    }

    return json({ success: true, data: profile })
  } catch (e) {
    console.error('[/api/user/me]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
