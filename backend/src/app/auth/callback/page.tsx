'use client'

/**
 * /auth/callback — Magic Link コールバックページ
 * ================================================
 * Supabase Magic Link クリック後にリダイレクトされるページ。
 * URL フラグメント (#access_token=...) または クエリパラメータ
 * (?code=...) からセッションを取得し、Chrome 拡張機能に通知する。
 *
 * フロー:
 *   1. ユーザーがメール内のリンクをクリック
 *   2. このページに遷移
 *   3. Supabase クライアントでセッション確立
 *   4. access_token を chrome.storage に保存
 *   5. ユーザーにタブを閉じるよう案内
 */

import { useEffect, useState } from 'react'

type Status = 'loading' | 'success' | 'error'

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState('')

  useEffect(() => {
    handleCallback()
  }, [])

  async function handleCallback() {
    try {
      // URL フラグメント (#access_token=...) を解析
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const tokenType = params.get('token_type')
      const userEmail = params.get('email') ?? ''

      if (!accessToken || tokenType !== 'bearer') {
        // PKCE フロー: ?code= の場合は Supabase client で処理
        const searchParams = new URLSearchParams(window.location.search)
        const code = searchParams.get('code')

        if (!code) {
          setStatus('error')
          return
        }

        // Supabase PKCE: code を access_token に交換
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

        const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseAnonKey,
          },
          body: JSON.stringify({ auth_code: code }),
        })

        if (!res.ok) { setStatus('error'); return }

        const data = await res.json()
        if (!data.access_token) { setStatus('error'); return }

        await storeTokenInExtension(data.access_token)
        setEmail(data.user?.email ?? '')
        setStatus('success')
        return
      }

      setEmail(userEmail)
      await storeTokenInExtension(accessToken)
      setStatus('success')
    } catch (e) {
      console.error('[auth/callback]', e)
      setStatus('error')
    }
  }

  async function storeTokenInExtension(token: string) {
    // chrome.storage API は Extension context でのみ利用可能
    // Web ページからは postMessage で extension に送信するか、
    // localStorage に保存して extension の content script が読み取る
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // 拡張機能のランタイムに直接送信（同一ブラウザの場合）
        chrome.runtime.sendMessage(
          { type: 'AUTH_TOKEN', token },
          () => { /* ignore errors */ },
        )
      }
    } catch {
      // 拡張機能が見つからない場合は無視
    }

    // フォールバック: localStorage（extension の content script が読み取る）
    localStorage.setItem('bukken_auth_token', token)
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoWrap}>
          <span style={s.logo}>bukken</span>
          <span style={s.logoDot}>.</span>
          <span style={s.logoIo}>io</span>
        </div>

        {status === 'loading' && (
          <>
            <div style={s.spinner} />
            <p style={s.text}>認証中...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={s.iconSuccess}>✓</div>
            <h1 style={s.title}>ログイン完了</h1>
            {email && <p style={s.email}>{email}</p>}
            <p style={s.text}>
              このタブを閉じて、Chrome 拡張機能に戻ってください。
            </p>
            <button style={s.btn} onClick={() => window.close()}>
              タブを閉じる
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={s.iconError}>✕</div>
            <h1 style={s.title}>認証に失敗しました</h1>
            <p style={s.text}>
              リンクが期限切れか、すでに使用されています。
              <br />
              拡張機能から再度ログインしてください。
            </p>
            <button style={s.btn} onClick={() => window.close()}>
              閉じる
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#FAFAF8',
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: '#fff',
    border: '0.5px solid #E0DED8',
    borderRadius: 16,
    padding: '48px 40px',
    textAlign: 'center',
    maxWidth: 380,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
  },
  logoWrap: { display: 'flex', alignItems: 'baseline' },
  logo: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a1a' },
  logoDot: { fontSize: 24, fontWeight: 700, color: '#185FA5' },
  logoIo: { fontSize: 22, fontWeight: 700, color: '#185FA5' },
  spinner: {
    width: 32, height: 32,
    border: '2.5px solid #E0DED8',
    borderTop: '2.5px solid #185FA5',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  iconSuccess: {
    width: 52, height: 52, borderRadius: '50%',
    background: '#E1F5EE', color: '#0F6E56',
    fontSize: 22, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  iconError: {
    width: 52, height: 52, borderRadius: '50%',
    background: '#FCEBEB', color: '#A32D2D',
    fontSize: 20, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: 700, margin: 0 },
  email: { fontSize: 13, color: '#888780', margin: 0 },
  text: { fontSize: 13, color: '#5F5E5A', lineHeight: 1.7, margin: 0 },
  btn: {
    padding: '11px 28px',
    background: '#185FA5', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
  },
}
