import { useState } from "react"
import { setAuthToken } from "../lib/api"

interface LoginPageProps {
  locale: "ja" | "zh-TW"
  onSuccess: () => void
}

const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY!

export default function LoginPage({ locale, onSuccess }: LoginPageProps) {
  const [email, setEmail] = useState("")
  const [step, setStep] = useState<"input" | "sent" | "loading">("input")
  const [error, setError] = useState<string | null>(null)

  const t = (ja: string, zh: string) => locale === "ja" ? ja : zh

  async function handleSendMagicLink() {
    if (!email || !email.includes("@")) {
      setError(t("正しいメールアドレスを入力してください", "請輸入有效的電子郵件"))
      return
    }
    setStep("loading")
    setError(null)

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          options: {
            emailRedirectTo: "https://bukken.io/auth/callback",
          },
        }),
      })

      if (!res.ok) throw new Error("Failed")
      setStep("sent")
    } catch {
      setError(t("送信に失敗しました。再度お試しください", "發送失敗，請再試一次"))
      setStep("input")
    }
  }

  return (
    <div style={s.root}>
      {/* Logo */}
      <div style={s.logoWrap}>
        <span style={s.logo}>bukken</span>
        <span style={s.logoDot}>.</span>
        <span style={s.logoIo}>io</span>
      </div>

      {step === "sent" ? (
        <div style={s.sentWrap}>
          <div style={s.sentIcon}>✉</div>
          <p style={s.sentTitle}>
            {t("メールを送信しました", "Email 已發送")}
          </p>
          <p style={s.sentDesc}>
            {email} {t(
              "にログインリンクを送りました。メールを確認してください。",
              "的收件匣中有登入連結，請查看信箱。"
            )}
          </p>
          <button
            style={s.ghostBtn}
            onClick={() => setStep("input")}
          >
            {t("メールアドレスを変更", "更改 Email")}
          </button>
        </div>
      ) : (
        <div style={s.formWrap}>
          <p style={s.tagline}>
            {t(
              "日本不動産をAIで分析する",
              "用 AI 分析日本房地產"
            )}
          </p>

          <div style={s.inputWrap}>
            <label style={s.label}>
              {t("メールアドレス", "電子郵件")}
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSendMagicLink()}
              placeholder={t("you@example.com", "you@example.com")}
              style={s.input}
              disabled={step === "loading"}
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            style={s.primaryBtn}
            onClick={handleSendMagicLink}
            disabled={step === "loading"}
          >
            {step === "loading"
              ? t("送信中...", "發送中...")
              : t("ログインリンクを送信 →", "發送登入連結 →")}
          </button>

          <p style={s.note}>
            {t(
              "パスワード不要。メールのリンクをクリックするだけ。",
              "無需密碼，點擊 Email 連結即可登入。"
            )}
          </p>

          <div style={s.divider} />

          <p style={s.freeNote}>
            {t(
              "無料でも物件の基本情報と価格差のヒントが見られます",
              "免費版可查看物件基本資訊與跨平台比價提示"
            )}
          </p>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 360,
    minHeight: "100vh",
    background: "#FAFAF8",
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
  },
  logoWrap: {
    display: "flex", alignItems: "baseline",
    marginBottom: 32,
  },
  logo: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", color: "#1a1a1a" },
  logoDot: { fontSize: 28, fontWeight: 700, color: "#185FA5" },
  logoIo: { fontSize: 24, fontWeight: 700, color: "#185FA5" },

  formWrap: {
    width: "100%",
    display: "flex", flexDirection: "column", gap: 14,
  },
  tagline: {
    fontSize: 16, fontWeight: 600, color: "#1a1a1a",
    textAlign: "center", margin: "0 0 8px",
  },
  inputWrap: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, color: "#5F5E5A", fontWeight: 500 },
  input: {
    width: "100%", padding: "10px 12px",
    border: "0.5px solid #D3D1C7",
    borderRadius: 8, fontSize: 14,
    background: "#fff",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  primaryBtn: {
    width: "100%", padding: "12px",
    background: "#185FA5", color: "#fff",
    border: "none", borderRadius: 8,
    fontSize: 14, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
  ghostBtn: {
    width: "100%", padding: "10px",
    background: "transparent",
    border: "0.5px solid #D3D1C7",
    borderRadius: 8, fontSize: 13,
    cursor: "pointer", color: "#5F5E5A",
    fontFamily: "inherit",
  },
  note: {
    fontSize: 11, color: "#888780",
    textAlign: "center", margin: 0, lineHeight: 1.6,
  },
  error: {
    fontSize: 12, color: "#A32D2D",
    background: "#FCEBEB",
    padding: "8px 12px", borderRadius: 8,
    margin: 0,
  },
  divider: {
    height: 1, background: "#E0DED8",
    margin: "4px 0",
  },
  freeNote: {
    fontSize: 11, color: "#888780",
    textAlign: "center", margin: 0, lineHeight: 1.6,
  },

  sentWrap: {
    width: "100%",
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: 14,
    textAlign: "center",
  },
  sentIcon: {
    fontSize: 40, lineHeight: 1,
    color: "#185FA5",
  },
  sentTitle: {
    fontSize: 16, fontWeight: 600, color: "#1a1a1a", margin: 0,
  },
  sentDesc: {
    fontSize: 13, color: "#5F5E5A", lineHeight: 1.6, margin: 0,
  },
}
