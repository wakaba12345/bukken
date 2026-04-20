'use client'

import { useState } from 'react'
import { PLANS } from 'shared/types'
import type { Plan } from 'shared/types'

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [locale, setLocale] = useState<'ja' | 'zh-TW'>('ja')

  const t = (ja: string, zh: string) => locale === 'ja' ? ja : zh

  async function handlePurchase(plan: Plan) {
    if (plan.id === 'payg') return // PAYG は別フロー
    setLoading(plan.id)

    try {
      const res = await fetch('/api/points/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      })
      const data = await res.json()

      if (data.success && data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl
      } else if (data.code === 'UNAUTHORIZED') {
        window.location.href = '/login'
      }
    } finally {
      setLoading(null)
    }
  }

  const packagePlans = PLANS.filter(p => p.id !== 'payg')
  const paygPlan = PLANS.find(p => p.id === 'payg')!

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.header}>
        <a href="/" style={s.logoLink}>
          <span style={s.logo}>bukken</span>
          <span style={s.logoDot}>.</span>
          <span style={s.logoIo}>io</span>
        </a>
        <button
          onClick={() => setLocale(l => l === 'ja' ? 'zh-TW' : 'ja')}
          style={s.localeBtn}
        >
          {locale === 'ja' ? '中文' : '日本語'}
        </button>
      </div>

      <div style={s.container}>
        {/* ── Hero ── */}
        <div style={s.hero}>
          <h1 style={s.heroTitle}>
            {t('ポイントプラン', '點數方案')}
          </h1>
          <p style={s.heroSub}>
            {t(
              '使った分だけ。有効期限内なら何度でも過去レポートを参照できます。',
              '用多少付多少。有效期內可無限次查看歷史報告。'
            )}
          </p>
        </div>

        {/* ── Point costs reference ── */}
        <div style={s.costTable}>
          {[
            { label: t('クロスプラットフォーム比較', '跨平台比對'), pt: t('0pt（会員特典）', '0pt（會員福利）'), color: '#0F6E56' },
            { label: t('クイックサマリー', '快速摘要'), pt: '6pt', color: '#BA7517' },
            { label: t('標準 AI レポート ★', '標準 AI 報告 ★'), pt: '10pt', color: '#185FA5' },
            { label: t('深度レポート', '深度報告'), pt: '30pt', color: '#534AB7' },
            { label: t('PDF ダウンロード', 'PDF 下載'), pt: '1pt', color: '#5F5E5A' },
          ].map(row => (
            <div key={row.label} style={s.costRow}>
              <span style={s.costLabel}>{row.label}</span>
              <span style={{ ...s.costPt, color: row.color }}>{row.pt}</span>
            </div>
          ))}
        </div>

        {/* ── Package plans ── */}
        <div style={s.plansGrid}>
          {packagePlans.map(plan => {
            const isStandard = plan.id === 'standard'
            const saving = plan.id === 'standard' ? 10
              : plan.id === 'pro' ? 21 : null

            return (
              <div
                key={plan.id}
                style={{
                  ...s.planCard,
                  ...(isStandard ? s.planCardFeatured : {}),
                }}
              >
                {isStandard && (
                  <div style={s.popularBadge}>
                    {t('最も人気', '最受歡迎')}
                  </div>
                )}

                <p style={s.planName}>{locale === 'ja' ? plan.nameJa : plan.nameZh}</p>
                <p style={s.planPoints}>{plan.points.toLocaleString()} pt</p>
                <p style={s.planPtSub}>
                  {t(`約${plan.points / 10}件の標準レポート`, `約 ${plan.points / 10} 份標準報告`)}
                </p>

                <div style={s.priceRow}>
                  <span style={s.priceMain}>¥{plan.priceJpy.toLocaleString()}</span>
                </div>
                <p style={s.pricePer}>¥{plan.perPointJpy.toFixed(1)} / pt</p>

                {saving && (
                  <p style={s.savingTag}>
                    {t(`入門パックより${saving}%お得`, `比入門包省 ${saving}%`)}
                  </p>
                )}

                <p style={s.validDays}>
                  {t(`有効期間：${plan.validDays}日間`, `有效期：${plan.validDays} 天`)}
                </p>

                <button
                  style={{
                    ...s.purchaseBtn,
                    ...(isStandard ? s.purchaseBtnPrimary : {}),
                  }}
                  onClick={() => handlePurchase(plan)}
                  disabled={loading === plan.id}
                >
                  {loading === plan.id
                    ? t('処理中...', '處理中...')
                    : t('購入する', '購買')}
                </button>
              </div>
            )
          })}
        </div>

        {/* ── PAYG ── */}
        <div style={s.paygCard}>
          <div style={s.paygLeft}>
            <p style={s.paygTitle}>{t('従量課金', '按量付費')}</p>
            <p style={s.paygSub}>
              {t(
                'クレジットカードを登録して使った分だけ支払い。まずは試したい方に。',
                '綁定信用卡，用多少付多少。適合偶爾使用的用戶。'
              )}
            </p>
          </div>
          <div style={s.paygRight}>
            <p style={s.paygPrice}>¥{paygPlan.perPointJpy} / pt</p>
            <p style={s.paygNote}>{t('パッケージより割高', '比套餐貴')}</p>
            <button style={s.paygBtn}>
              {t('カードを登録 →', '綁定信用卡 →')}
            </button>
          </div>
        </div>

        {/* ── FAQ ── */}
        <div style={s.faq}>
          {[
            {
              q: t('ポイントの有効期限は？', '點數有效期限是？'),
              a: t(
                '入門パック90日、スタンダード180日、プロ365日。期限切れのポイントは失効します。',
                '入門包90天、標準包180天、專業包365天。到期未使用的點數將失效。'
              ),
            },
            {
              q: t('一度生成したレポートは再度ポイントが必要ですか？', '已生成的報告需要再次消耗點數嗎？'),
              a: t(
                'いいえ。一度生成したレポートは有効期限内であれば何度でも無料で閲覧できます。',
                '不需要。已生成的報告在有效期內可免費無限次查看。'
              ),
            },
            {
              q: t('返金はできますか？', '可以退款嗎？'),
              a: t(
                '未使用ポイントが残っている場合は購入から7日以内に限り対応可能です。',
                '若有未使用點數，購買後7天內可申請退款。'
              ),
            },
          ].map(item => (
            <div key={item.q} style={s.faqItem}>
              <p style={s.faqQ}>{item.q}</p>
              <p style={s.faqA}>{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#FAFAF8',
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '0.5px solid #E0DED8',
    background: '#fff',
    position: 'sticky', top: 0, zIndex: 10,
  },
  logoLink: { textDecoration: 'none', display: 'flex', alignItems: 'baseline' },
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a1a' },
  logoDot: { fontSize: 22, fontWeight: 700, color: '#185FA5' },
  logoIo: { fontSize: 20, fontWeight: 700, color: '#185FA5' },
  localeBtn: {
    fontSize: 12, padding: '5px 12px',
    border: '0.5px solid #D3D1C7', borderRadius: 6,
    background: 'transparent', color: '#5F5E5A', cursor: 'pointer',
  },

  container: {
    maxWidth: 720, margin: '0 auto',
    padding: '40px 24px 80px',
  },

  hero: { textAlign: 'center', marginBottom: 32 },
  heroTitle: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 10px' },
  heroSub: { fontSize: 14, color: '#5F5E5A', lineHeight: 1.7, margin: 0 },

  costTable: {
    background: '#fff',
    border: '0.5px solid #E0DED8',
    borderRadius: 12, overflow: 'hidden',
    marginBottom: 28,
  },
  costRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '0.5px solid #F1EFE8',
  },
  costLabel: { fontSize: 13, color: '#2C2C2A' },
  costPt: { fontSize: 13, fontWeight: 600 },

  plansGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12, marginBottom: 16,
  },
  planCard: {
    background: '#fff',
    border: '0.5px solid #E0DED8',
    borderRadius: 12, padding: '20px 16px',
    display: 'flex', flexDirection: 'column', gap: 4,
    position: 'relative',
  },
  planCardFeatured: {
    border: '2px solid #185FA5',
  },
  popularBadge: {
    position: 'absolute', top: -10, left: '50%',
    transform: 'translateX(-50%)',
    background: '#185FA5', color: '#fff',
    fontSize: 10, fontWeight: 600,
    padding: '3px 10px', borderRadius: 10,
    whiteSpace: 'nowrap',
  },
  planName: { fontSize: 13, fontWeight: 600, color: '#5F5E5A', margin: '8px 0 0' },
  planPoints: { fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 0', color: '#1a1a1a' },
  planPtSub: { fontSize: 11, color: '#888780', margin: '0 0 8px' },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 4 },
  priceMain: { fontSize: 22, fontWeight: 700, color: '#185FA5' },
  pricePer: { fontSize: 11, color: '#888780', margin: '2px 0 4px' },
  savingTag: { fontSize: 11, color: '#0F6E56', fontWeight: 500 },
  validDays: { fontSize: 11, color: '#B4B2A9', margin: '4px 0 12px' },
  purchaseBtn: {
    width: '100%', padding: '10px',
    border: '0.5px solid #D3D1C7', borderRadius: 8,
    background: '#FAFAF8', color: '#1a1a1a',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
    marginTop: 'auto',
  },
  purchaseBtnPrimary: {
    background: '#185FA5', color: '#fff',
    border: 'none',
  },

  paygCard: {
    background: '#fff',
    border: '0.5px solid #E0DED8',
    borderRadius: 12, padding: '16px 20px',
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', gap: 16,
    marginBottom: 40,
  },
  paygLeft: { flex: 1 },
  paygTitle: { fontSize: 14, fontWeight: 600, margin: '0 0 4px' },
  paygSub: { fontSize: 12, color: '#5F5E5A', lineHeight: 1.6, margin: 0 },
  paygRight: { textAlign: 'right', flexShrink: 0 },
  paygPrice: { fontSize: 20, fontWeight: 700, color: '#185FA5', margin: '0 0 2px' },
  paygNote: { fontSize: 11, color: '#A32D2D', margin: '0 0 8px' },
  paygBtn: {
    padding: '8px 16px',
    background: 'transparent',
    border: '0.5px solid #185FA5',
    borderRadius: 8, color: '#185FA5',
    fontSize: 12, cursor: 'pointer',
  },

  faq: { borderTop: '0.5px solid #E0DED8', paddingTop: 32, display: 'flex', flexDirection: 'column', gap: 20 },
  faqItem: {},
  faqQ: { fontSize: 13, fontWeight: 600, margin: '0 0 4px' },
  faqA: { fontSize: 13, color: '#5F5E5A', lineHeight: 1.7, margin: 0 },
}
