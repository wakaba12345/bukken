import { useState } from "react"
import { PLANS } from "../../../shared/types"
import type { Plan, UserProfile } from "../../../shared/types"
import { purchasePoints } from "../lib/api"

interface PricingPageProps {
  user: UserProfile | null
  currentPoints: number
  locale: "ja" | "zh-TW"
  onClose: () => void
}

export default function PricingPage({
  user,
  currentPoints,
  locale,
  onClose,
}: PricingPageProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const t = (ja: string, zh: string) => locale === "ja" ? ja : zh

  // 套餐のみ（paygは別扱い）
  const plans = PLANS.filter(p => p.id !== "payg")
  const paygPlan = PLANS.find(p => p.id === "payg")!

  async function handlePurchase(planId: string) {
    if (!user) {
      chrome.tabs.create({ url: "https://bukken.io/login" })
      return
    }
    setLoading(planId)
    setError(null)
    try {
      const res = await purchasePoints(planId)
      if (res.success && res.data?.checkoutUrl) {
        chrome.tabs.create({ url: res.data.checkoutUrl })
      } else {
        setError(t("エラーが発生しました", "發生錯誤"))
      }
    } catch {
      setError(t("エラーが発生しました", "發生錯誤"))
    } finally {
      setLoading(null)
    }
  }

  // TWD換算（固定レート、実際はAPIから取得）
  const jpyToTwd = (jpy: number) => Math.round(jpy * 0.218)

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <button onClick={onClose} style={s.backBtn}>← {t("戻る", "返回")}</button>
        <span style={s.headerTitle}>{t("ポイントを購入", "購買點數")}</span>
        {currentPoints > 0 && (
          <span style={s.currentPt}>{currentPoints.toLocaleString()} pt</span>
        )}
      </div>

      <div style={s.content}>
        {/* 説明 */}
        <p style={s.desc}>
          {t(
            "ポイントを購入してAI分析レポートを生成できます。",
            "購買點數後可生成 AI 分析報告。"
          )}
        </p>

        {/* 消費ポイント早見表 */}
        <div style={s.costTable}>
          {[
            { label: t("クイックサマリー", "快速摘要"), pt: 6, note: t("不划算（参考用）", "定價刻意較高") },
            { label: t("標準レポート ★", "標準報告 ★"), pt: 10, note: t("おすすめ", "推薦") },
            { label: t("深度デューデリジェンス", "深度盡調"), pt: 30, note: t("詳細分析", "完整分析") },
            { label: t("PDF ダウンロード", "PDF 下載"), pt: 1, note: "" },
          ].map(row => (
            <div key={row.label} style={s.costRow}>
              <span style={s.costLabel}>{row.label}</span>
              <div style={s.costRight}>
                {row.note && <span style={s.costNote}>{row.note}</span>}
                <span style={s.costPt}>{row.pt} pt</span>
              </div>
            </div>
          ))}
        </div>

        {/* プランカード */}
        <div style={s.plansWrap}>
          {plans.map(plan => {
            const isRecommended = plan.id === "standard"
            const saving = plan.id !== "starter"
              ? Math.round((1 - plan.perPointJpy / 9.93) * 100)
              : 0

            return (
              <div
                key={plan.id}
                style={{
                  ...s.planCard,
                  ...(isRecommended ? s.planCardFeatured : {}),
                }}
              >
                {isRecommended && (
                  <div style={s.recommendedBadge}>
                    {t("最も人気", "最受歡迎")}
                  </div>
                )}

                <div style={s.planTop}>
                  <p style={s.planName}>
                    {locale === "ja" ? plan.nameJa : plan.nameZh}
                  </p>
                  <p style={s.planPoints}>
                    {plan.points.toLocaleString()}
                    <span style={s.planPtLabel}> pt</span>
                  </p>
                  <p style={s.planEquiv}>
                    {t(
                      `標準レポート約${Math.floor(plan.points / 10)}回分`,
                      `約 ${Math.floor(plan.points / 10)} 份標準報告`
                    )}
                  </p>
                </div>

                <div style={s.planPriceWrap}>
                  <p style={s.planPrice}>
                    ¥{plan.priceJpy.toLocaleString()}
                  </p>
                  <p style={s.planPriceTwd}>
                    ≈ NT${jpyToTwd(plan.priceJpy).toLocaleString()}
                  </p>
                  <p style={s.planPerPt}>
                    ¥{plan.perPointJpy.toFixed(1)}/pt
                    {saving > 0 && (
                      <span style={s.savingBadge}>
                        {saving}% {t("お得", "優惠")}
                      </span>
                    )}
                  </p>
                </div>

                <p style={s.planExpiry}>
                  {t(
                    `有効期限 ${plan.validDays}日`,
                    `有效期 ${plan.validDays} 天`
                  )}
                </p>

                <button
                  style={{
                    ...s.purchaseBtn,
                    ...(isRecommended ? s.purchaseBtnFeatured : {}),
                  }}
                  onClick={() => handlePurchase(plan.id)}
                  disabled={loading === plan.id}
                >
                  {loading === plan.id
                    ? t("処理中...", "處理中...")
                    : t("購入する →", "立即購買 →")}
                </button>
              </div>
            )
          })}
        </div>

        {/* 従量課金 */}
        <div style={s.paygCard}>
          <div style={s.paygLeft}>
            <p style={s.paygTitle}>{t("従量課金", "按量付費")}</p>
            <p style={s.paygDesc}>
              {t(
                "クレジットカードを登録して使った分だけ課金。",
                "綁定信用卡，用多少扣多少。"
              )}
            </p>
          </div>
          <div style={s.paygRight}>
            <p style={s.paygPrice}>¥{paygPlan.perPointJpy}/pt</p>
            <button
              style={s.paygBtn}
              onClick={() => handlePurchase("payg")}
              disabled={loading === "payg"}
            >
              {t("登録", "設定")}
            </button>
          </div>
        </div>

        {error && <p style={s.errorText}>{error}</p>}

        {/* 注意事項 */}
        <div style={s.notes}>
          <p style={s.noteItem}>
            {t("・決済は円建てです（TWDは参考値）", "・以日圓計費（台幣為參考值）")}
          </p>
          <p style={s.noteItem}>
            {t("・ポイントは有効期限内に使い切ってください", "・點數請在有效期內使用完畢")}
          </p>
          <p style={s.noteItem}>
            {t("・決済は Stripe（J&E 株式会社）", "・由 Stripe（J&E 株式会社）處理")}
          </p>
          <p style={s.noteItem}>
            {t(
              "・領収書はご購入後メールにて送付されます",
              "・收據將於購買後以 Email 寄送"
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 360,
    minHeight: "100vh",
    background: "#FAFAF8",
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "0.5px solid #E0DED8",
    background: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  backBtn: {
    background: "none", border: "none",
    fontSize: 12, color: "#5F5E5A",
    cursor: "pointer", padding: 0,
  },
  headerTitle: {
    fontSize: 13, fontWeight: 600, color: "#1a1a1a",
  },
  currentPt: {
    fontSize: 12, color: "#085041",
    background: "#E1F5EE",
    padding: "2px 8px", borderRadius: 6,
  },

  content: {
    padding: "14px 16px",
    display: "flex", flexDirection: "column", gap: 14,
  },

  desc: {
    fontSize: 12, color: "#5F5E5A", lineHeight: 1.6, margin: 0,
  },

  costTable: {
    background: "#fff",
    border: "0.5px solid #E0DED8",
    borderRadius: 10, overflow: "hidden",
  },
  costRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 14px",
    borderBottom: "0.5px solid #F1EFE8",
  },
  costLabel: { fontSize: 12, color: "#2C2C2A" },
  costRight: { display: "flex", alignItems: "center", gap: 6 },
  costNote: {
    fontSize: 10, color: "#854F0B",
    background: "#FAEEDA", padding: "1px 6px", borderRadius: 4,
  },
  costPt: {
    fontSize: 13, fontWeight: 700, color: "#185FA5",
    minWidth: 40, textAlign: "right",
  },

  plansWrap: {
    display: "flex", flexDirection: "column", gap: 10,
  },
  planCard: {
    background: "#fff",
    border: "0.5px solid #E0DED8",
    borderRadius: 12,
    padding: "14px",
    position: "relative",
  },
  planCardFeatured: {
    border: "2px solid #185FA5",
  },
  recommendedBadge: {
    position: "absolute",
    top: -10, left: 14,
    background: "#185FA5", color: "#fff",
    fontSize: 10, fontWeight: 600,
    padding: "2px 10px", borderRadius: 20,
  },
  planTop: { marginBottom: 10 },
  planName: {
    fontSize: 14, fontWeight: 600, color: "#1a1a1a",
    margin: "0 0 4px",
  },
  planPoints: {
    fontSize: 28, fontWeight: 700, color: "#185FA5",
    margin: "0 0 2px", lineHeight: 1.2,
  },
  planPtLabel: { fontSize: 14 },
  planEquiv: { fontSize: 11, color: "#888780", margin: 0 },

  planPriceWrap: { marginBottom: 8 },
  planPrice: {
    fontSize: 20, fontWeight: 700, color: "#1a1a1a",
    margin: "0 0 2px",
  },
  planPriceTwd: { fontSize: 11, color: "#888780", margin: "0 0 4px" },
  planPerPt: {
    fontSize: 12, color: "#5F5E5A", margin: 0,
    display: "flex", alignItems: "center", gap: 6,
  },
  savingBadge: {
    fontSize: 10, color: "#085041",
    background: "#E1F5EE",
    padding: "1px 6px", borderRadius: 4, fontWeight: 600,
  },

  planExpiry: {
    fontSize: 11, color: "#888780", margin: "0 0 12px",
  },

  purchaseBtn: {
    width: "100%", padding: "10px",
    background: "#F1EFE8",
    border: "0.5px solid #D3D1C7",
    borderRadius: 8, fontSize: 13,
    fontWeight: 600, cursor: "pointer",
    color: "#2C2C2A",
    fontFamily: "inherit",
  },
  purchaseBtnFeatured: {
    background: "#185FA5", color: "#fff",
    border: "none",
  },

  paygCard: {
    background: "#fff",
    border: "0.5px solid #E0DED8",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  paygLeft: { flex: 1 },
  paygTitle: { fontSize: 13, fontWeight: 600, margin: "0 0 3px" },
  paygDesc: { fontSize: 11, color: "#888780", margin: 0, lineHeight: 1.5 },
  paygRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 },
  paygPrice: { fontSize: 14, fontWeight: 700, color: "#A32D2D", margin: 0 },
  paygBtn: {
    padding: "6px 14px",
    background: "transparent",
    border: "0.5px solid #D3D1C7",
    borderRadius: 6, fontSize: 12,
    cursor: "pointer", color: "#5F5E5A",
    fontFamily: "inherit",
  },

  errorText: {
    fontSize: 12, color: "#A32D2D",
    background: "#FCEBEB",
    padding: "8px 12px", borderRadius: 8,
    margin: 0,
  },

  notes: {
    padding: "10px 12px",
    background: "#F1EFE8",
    borderRadius: 8,
  },
  noteItem: {
    fontSize: 11, color: "#888780",
    margin: "0 0 4px", lineHeight: 1.5,
  },
}
