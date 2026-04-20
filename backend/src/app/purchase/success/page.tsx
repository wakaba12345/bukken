'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// Supabase クライアントはブラウザの localStorage からセッションを読み取る
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export default function PurchaseSuccessPage() {
  const params = useSearchParams()
  const sessionId = params.get('session_id')
  const [points, setPoints] = useState<number | null>(null)
  const [planName, setPlanName] = useState<string>('')

  useEffect(() => {
    if (!sessionId) return
    fetchBalance()
  }, [sessionId])

  async function fetchBalance() {
    try {
      // Supabase の localStorage セッションからアクセストークンを取得
      const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
      const stored = localStorage.getItem(storageKey)
      const session = stored ? JSON.parse(stored) : null
      const token = session?.access_token

      if (!token) return

      const res = await fetch('/api/points/balance', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) setPoints(data.data.balance)

      // Stripe セッション情報から購入プラン名を取得（クライアント安全な情報のみ）
      const sessionRes = await fetch(`/api/purchase/session?id=${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json()
        if (sessionData.success) setPlanName(sessionData.data.planName ?? '')
      }
    } catch {
      // 取得できなくてもページは表示する
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.checkmark}>✓</div>
        <h1 style={s.title}>購入が完了しました</h1>
        <p style={s.sub}>
          {planName ? `${planName}のポイントが` : 'ポイントが'}
          アカウントに追加されました
        </p>
        {points !== null && (
          <div style={s.balanceBox}>
            <p style={s.balanceLabel}>現在の残高</p>
            <p style={s.balanceNum}>{points.toLocaleString()} pt</p>
          </div>
        )}
        <div style={s.btnGroup}>
          <a href="/pricing" style={{ ...s.btn, ...s.btnGhost }}>
            プランを見る
          </a>
          <a href="https://chromewebstore.google.com" target="_blank" rel="noreferrer" style={s.btn}>
            Chrome 拡張機能を開く →
          </a>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#FAFAF8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    padding: 20,
  },
  card: {
    background: '#fff', borderRadius: 16,
    border: '0.5px solid #E0DED8',
    padding: '48px 40px', textAlign: 'center',
    maxWidth: 420, width: '100%',
  },
  checkmark: {
    width: 56, height: 56, borderRadius: '50%',
    background: '#E1F5EE', color: '#0F6E56',
    fontSize: 24, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto 20px',
  },
  title: { fontSize: 22, fontWeight: 700, margin: '0 0 8px' },
  sub: { fontSize: 14, color: '#5F5E5A', margin: '0 0 24px', lineHeight: 1.6 },
  balanceBox: {
    background: '#F1EFE8', borderRadius: 10,
    padding: '16px', marginBottom: 24,
  },
  balanceLabel: { fontSize: 12, color: '#5F5E5A', margin: '0 0 4px' },
  balanceNum: { fontSize: 28, fontWeight: 700, color: '#185FA5', margin: 0 },
  btnGroup: { display: 'flex', flexDirection: 'column', gap: 10 },
  btn: {
    display: 'block', padding: '12px 24px',
    background: '#185FA5', color: '#fff',
    borderRadius: 8, textDecoration: 'none',
    fontSize: 14, fontWeight: 600,
  },
  btnGhost: {
    background: 'transparent',
    border: '0.5px solid #D3D1C7',
    color: '#5F5E5A',
  },
}
