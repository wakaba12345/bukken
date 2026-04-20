import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createCheckoutSession } from '@/lib/stripe'
import { PLANS } from 'shared/types'
import type { PlanId, ApiResponse } from 'shared/types'

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const { data: { user }, error: authError } = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    ).auth.getUser(token)

    if (authError || !user) {
      return json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }

    // ── プランバリデーション ───────────────────────────────────────────────────
    const { planId, locale } = await req.json() as { planId: PlanId; locale?: 'ja' | 'zh-TW' }
    const plan = PLANS.find(p => p.id === planId && p.id !== 'payg')
    if (!plan) return json({ success: false, error: 'Invalid plan' }, 400)

    // ── Stripe Checkout Session 作成 ──────────────────────────────────────────
    const checkoutUrl = await createCheckoutSession(
      user.id,
      user.email ?? '',
      planId,
      locale ?? 'ja',
    )

    return json({ success: true, data: { checkoutUrl } })

  } catch (e) {
    console.error('[/api/points/purchase]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
