import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getPointBalance } from '@/lib/supabase'
import type { ApiResponse } from 'shared/types'

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.getUser(token)

    if (error || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const balance = await getPointBalance(user.id)
    return NextResponse.json({ success: true, data: { balance } })
  } catch (e) {
    console.error('[/api/points/balance]', e)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
