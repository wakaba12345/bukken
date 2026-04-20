import Stripe from 'stripe'
import { PLANS } from 'shared/types'
import type { PlanId } from 'shared/types'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

// ─── Stripe Products / Prices の初期設定 ─────────────────────────────────────
// 初回のみ実行: npm run stripe:setup

export async function createStripeProducts() {
  for (const plan of PLANS) {
    if (plan.id === 'payg') continue // 従量課金は別処理

    const product = await stripe.products.create({
      name: `Bukken.io ${plan.nameJa}`,
      metadata: {
        plan_id: plan.id,
        points: String(plan.points),
        valid_days: String(plan.validDays),
      },
    })

    await stripe.prices.create({
      product: product.id,
      unit_amount: plan.priceJpy,
      currency: 'jpy',
      metadata: {
        plan_id: plan.id,
        points: String(plan.points),
      },
    })

    console.log(`Created: ${plan.id} → ${product.id}`)
  }
}

// ─── Checkout Session 作成 ────────────────────────────────────────────────────

export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  planId: PlanId,
  locale: 'ja' | 'zh-TW' = 'ja',
): Promise<string> {
  const plan = PLANS.find(p => p.id === planId)
  if (!plan || plan.id === 'payg') throw new Error('Invalid plan')

  // Stripe Price ID を取得（metadata で検索）
  const prices = await stripe.prices.list({
    active: true,
    limit: 100,
  })
  const price = prices.data.find(p => p.metadata.plan_id === planId)
  if (!price) throw new Error(`Stripe price not found for plan: ${planId}`)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: userEmail,
    locale: locale === 'ja' ? 'ja' : 'zh',
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
    metadata: {
      user_id: userId,
      plan_id: planId,
      points: String(plan.points),
    },
    success_url: `https://bukken.io/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `https://bukken.io/purchase/cancel`,
    payment_intent_data: {
      metadata: {
        user_id: userId,
        plan_id: planId,
        points: String(plan.points),
      },
    },
  })

  return session.url!
}

// ─── 従量課金: PaymentIntent 作成 ────────────────────────────────────────────

export async function createPaygPaymentIntent(
  userId: string,
  points: number,
): Promise<{ clientSecret: string; amount: number }> {
  const paygPlan = PLANS.find(p => p.id === 'payg')!
  const amount = Math.ceil(points * paygPlan.perPointJpy)

  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'jpy',
    automatic_payment_methods: { enabled: true },
    metadata: {
      user_id: userId,
      plan_id: 'payg',
      points: String(points),
    },
  })

  return {
    clientSecret: intent.client_secret!,
    amount,
  }
}

// ─── Webhook イベント検証 ─────────────────────────────────────────────────────

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )
}
