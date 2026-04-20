import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import type { ApiResponse } from 'shared/types'

// Stripe Checkout セッション情報を取得（購入完了ページ表示用）
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return json({ success: false, error: 'Missing session id' }, 400)

    const session = await stripe.checkout.sessions.retrieve(id)

    if (session.payment_status !== 'paid') {
      return json({ success: false, error: 'Payment not completed' }, 400)
    }

    // プラン名（日本語）を metadata から取得
    const planId = session.metadata?.plan_id ?? ''
    const planNames: Record<string, string> = {
      starter: '入門パック',
      standard: 'スタンダードパック',
      pro: 'プロパック',
    }

    return json({
      success: true,
      data: {
        planId,
        planName: planNames[planId] ?? planId,
        points: parseInt(session.metadata?.points ?? '0'),
      },
    })
  } catch (e) {
    console.error('[/api/purchase/session]', e)
    return json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
}

function json(body: ApiResponse<unknown>, status = 200) {
  return NextResponse.json(body, { status })
}
