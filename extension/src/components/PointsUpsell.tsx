import { useState } from 'react'
import { PLANS } from '../../../shared/types'
import type { Plan } from '../../../shared/types'
import { purchasePoints } from '../lib/api'

interface Props {
  currentPoints: number
  requiredPoints: number
  onClose: () => void
  locale: 'ja' | 'zh-TW'
}

export default function PointsUpsell({ currentPoints, requiredPoints, onClose, locale }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const t = (ja: string, zh: string) => locale === 'ja' ? ja : zh

  const packagePlans = PLANS.filter(p => p.id !== 'payg')
  const shortage = requiredPoints - currentPoints

  async function handlePurchase(plan: Plan) {
    setLoading(plan.id)
    const res = await purchasePoints(plan.id)
    if (res.success && res.data?.checkoutUrl) {
      chrome.tabs.create({ url: res.data.checkoutUrl })
    }
    setLoading(null)
  }

  return (
    <div style={s.overlay}>
      <div style={s.sheet}>
        <div style={s.sheetHeader}>
          <div>
            <p style={s.sheetTitle}>{t('ポイントが不足しています', '點數不足')}</p>
            <p style={s.sheetSub}>
              {t(`あと ${shortage}pt 必要です`, `還需要 ${shortage}pt`)}
              {' · '}
              {t(`現在 ${currentPoints}pt`, `目前 ${currentPoints}pt`)}
            </p>
          </div>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>

        <div style={s.plans}>
          {packagePlans.map(plan => {
            const isRecommended = plan.points >= requiredPoints + currentPoints
              ? plan.id === 'standard'
              : true

            return (
              <button
                key={plan.id}
                style={{
                  ...s.planBtn,
                  ...(isRecommended && plan.id === 'standard' ? s.planBtnFeatured : {}),
                }}
                onClick={() => handlePurchase(plan)}
                disabled={loading === plan.id}
              >
                <div style={s.planLeft}>
                  <span style={s.planName}>{locale === 'ja' ? plan.nameJa : plan.nameZh}</span>
                  <span style={s.planSub}>{plan.points.toLocaleString()} pt · {t(`${plan.validDays}日間有効`, `${plan.validDays} 天有效`)}</span>
                </div>
                <div style={s.planRight}>
                  <span style={s.planPrice}>¥{plan.priceJpy.toLocaleString()}</span>
                  {loading === plan.id
                    ? <span style={s.planNote}>{t('処理中', '處理中')}...</span>
                    : <span style={s.planNote}>¥{plan.perPointJpy.toFixed(1)}/pt</span>
                  }
                </div>
              </button>
            )
          })}
        </div>

        <button
          style={s.paygBtn}
          onClick={() => chrome.tabs.create({ url: 'https://bukken.io/pricing#payg' })}
        >
          {t('従量課金（都度払い）で試す →', '按量付費試用 →')}
        </button>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    width: '100%',
    background: '#fff',
    borderRadius: '14px 14px 0 0',
    padding: '16px',
  },
  sheetHeader: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 14,
  },
  sheetTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 2px' },
  sheetSub: { fontSize: 12, color: '#888780', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none',
    fontSize: 16, color: '#888780', cursor: 'pointer',
    padding: 4,
  },
  plans: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 },
  planBtn: {
    width: '100%', padding: '12px 14px',
    border: '0.5px solid #E0DED8', borderRadius: 10,
    background: '#FAFAF8', cursor: 'pointer',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontFamily: 'inherit',
  },
  planBtnFeatured: {
    border: '1.5px solid #185FA5',
    background: '#E6F1FB',
  },
  planLeft: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  planName: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
  planSub: { fontSize: 11, color: '#5F5E5A' },
  planRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  planPrice: { fontSize: 16, fontWeight: 700, color: '#185FA5' },
  planNote: { fontSize: 10, color: '#888780' },
  paygBtn: {
    width: '100%', padding: '10px',
    background: 'transparent',
    border: '0.5px solid #D3D1C7',
    borderRadius: 8, color: '#5F5E5A',
    fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
