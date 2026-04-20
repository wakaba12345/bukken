import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent } from '@/lib/stripe'
import { addPoints } from '@/lib/supabase'
import type Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const payload = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(payload, signature)
  } catch (e) {
    console.error('[Webhook] Signature verification failed:', e)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.payment_status !== 'paid') break
        const userId = session.metadata?.user_id
        const planId = session.metadata?.plan_id
        const points = parseInt(session.metadata?.points ?? '0')
        if (!userId || !planId || !points) break
        await addPoints(userId, points, planId)
        console.log(`[Webhook] +${points}pt → user ${userId} (${planId})`)
        break
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent
        if (intent.metadata?.plan_id !== 'payg') break
        const userId = intent.metadata?.user_id
        const points = parseInt(intent.metadata?.points ?? '0')
        if (!userId || !points) break
        await addPoints(userId, points, 'payg')
        console.log(`[Webhook] PAYG +${points}pt → user ${userId}`)
        break
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        console.warn('[Webhook] Refund:', charge.id)
        break
      }
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    console.error('[Webhook] Error:', e)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
