import { useState, useEffect } from "react"
import type {
  PropertyData,
  CrossPlatformResult,
  ReportContent,
  UserProfile,
} from "../../../shared/types"
import { POINT_COSTS } from "../../../shared/types"
import {
  getMe,
  getPointBalance,
  searchCrossPlatform,
  createReport,
} from "../lib/api"
import { searchAllPlatforms, type PlatformSearchResult } from "../lib/crossSearch"
import PricingPage from "./PricingPage"
import LoginPage from "./LoginPage"
import PointsUpsell from "../components/PointsUpsell"

type View = "idle" | "loading" | "free" | "paid"
type ReportState = "none" | "generating" | "done" | "error" | "upsell"
type Page = "main" | "pricing" | "login"

export default function SidePanel() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [points, setPoints] = useState<number | null>(null)
  const [property, setProperty] = useState<PropertyData | null>(null)
  const [cross, setCross] = useState<CrossPlatformResult | null>(null)
  const [crossSearch, setCrossSearch] = useState<PlatformSearchResult[] | null>(null)
  const [crossSearching, setCrossSearching] = useState(false)
  const [report, setReport] = useState<ReportContent | null>(null)
  const [reportState, setReportState] = useState<ReportState>("none")
  const [attemptedReportType, setAttemptedReportType] = useState<"quick_summary" | "standard_report" | "deep_report">("quick_summary")
  const [view, setView] = useState<View>("idle")
  const [page, setPage] = useState<Page>("main")
  const [locale, setLocale] = useState<"ja" | "zh-TW">("ja")

  // ── 初期化 ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    initUser()
    listenForProperty()
    requestCurrentProperty()
  }, [])

  async function initUser() {
    const res = await getMe()
    if (res.success && res.data) {
      setUser(res.data)
      setLocale(res.data.locale)
      const bal = await getPointBalance()
      if (bal.success && bal.data) setPoints(bal.data.balance)
    } else {
      // dev bypass: 未ログインでもボタンを押せるよう仮のポイントを設定
      setPoints(9999)
    }
  }

  function listenForProperty() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "PROPERTY_UPDATED" && msg.payload) {
        handleNewProperty(msg.payload)
      }
    })
  }

  function requestCurrentProperty() {
    chrome.runtime.sendMessage(
      { type: "GET_CURRENT_PROPERTY" },
      (res) => { if (res?.property) handleNewProperty(res.property) }
    )
  }

  async function handleNewProperty(prop: PropertyData) {
    setProperty(prop)
    setReport(null)
    setReportState("none")
    setCross(null)
    setCrossSearch(null)
    setView("loading")

    // dev モード：未ログインでも paid view に入って報告生成を試せる
    const crossRes = await searchCrossPlatform(prop)
    if (crossRes.success && crossRes.data) setCross(crossRes.data)

    setView("paid")

    // ブラウザ側クロスプラットフォーム検索（各サイトを直接検索）
    setCrossSearching(true)
    searchAllPlatforms(prop.name, prop.address, prop.platform)
      .then(results => { setCrossSearch(results); setCrossSearching(false) })
      .catch(() => setCrossSearching(false))
    const bal = await getPointBalance()
    if (bal.success && bal.data) setPoints(bal.data.balance)
  }

  async function handleGenerateReport(type: "quick_summary" | "standard_report" | "deep_report") {
    if (!property) return
    setAttemptedReportType(type)
    setReportState("generating")
    const res = await createReport(property, type)
    if (res.success && res.data) {
      setReport(res.data)
      setReportState("done")
      const bal = await getPointBalance()
      if (bal.success && bal.data) setPoints(bal.data.balance)
    } else {
      setReportState(res.code === "INSUFFICIENT_POINTS" ? "upsell" : "error")
    }
  }

  const t = (ja: string, zh: string) => locale === "ja" ? ja : zh

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      <Header
        points={points}
        locale={locale}
        onToggleLocale={() => setLocale(l => l === "ja" ? "zh-TW" : "ja")}
        user={user}
      />

      {view === "idle" && <IdleState t={t} />}
      {view === "loading" && <LoadingState t={t} />}
      {view === "free" && property && (
        <FreeView property={property} t={t} />
      )}
      {view === "paid" && property && (
        <PaidView
          property={property}
          cross={cross}
          crossSearch={crossSearch}
          crossSearching={crossSearching}
          report={report}
          reportState={reportState}
          points={points ?? 0}
          onGenerateReport={handleGenerateReport}
          t={t}
        />
      )}

      {reportState === "upsell" && (
        <PointsUpsell
          currentPoints={points ?? 0}
          requiredPoints={POINT_COSTS[attemptedReportType]}
          onClose={() => setReportState("none")}
          locale={locale}
        />
      )}
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({ points, locale, onToggleLocale, user }: {
  points: number | null
  locale: "ja" | "zh-TW"
  onToggleLocale: () => void
  user: UserProfile | null
}) {
  return (
    <div style={styles.header}>
      <div style={styles.headerLeft}>
        <span style={styles.logo}>bukken</span>
        <span style={styles.logoDot}>.</span>
        <span style={styles.logoIo}>io</span>
      </div>
      <div style={styles.headerRight}>
        <button onClick={onToggleLocale} style={styles.localeBtn}>
          {locale === "ja" ? "中文" : "日本語"}
        </button>
        {user && points !== null && (
          <div style={styles.pointsBadge}>
            <span style={styles.pointsNum}>{points.toLocaleString()}</span>
            <span style={styles.pointsLabel}>pt</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Idle state ───────────────────────────────────────────────────────────────

function IdleState({ t }: { t: (ja: string, zh: string) => string }) {
  return (
    <div style={styles.idleWrap}>
      <div style={styles.idleIcon}>🏠</div>
      <p style={styles.idleText}>
        {t("物件ページを開くと", "開啟物件頁面")}
        <br />
        {t("自動で分析を開始します", "即自動開始分析")}
      </p>
    </div>
  )
}

// ── Loading ──────────────────────────────────────────────────────────────────

function LoadingState({ t }: { t: (ja: string, zh: string) => string }) {
  return (
    <div style={styles.idleWrap}>
      <div style={styles.spinner} />
      <p style={styles.idleText}>{t("物件情報を取得中...", "取得物件資訊中...")}</p>
    </div>
  )
}

// ── Free view（未ログインユーザー）──────────────────────────────────────────

function FreeView({ property, t }: {
  property: PropertyData
  t: (ja: string, zh: string) => string
}) {
  const fakeOtherPrice = property.price - 820000
  return (
    <div style={styles.content}>
      <PropertySummary property={property} t={t} />

      {/* クロスプラットフォーム（ぼかし） */}
      <Section title={t("クロスプラットフォーム比較", "跨平台比對")}>
        <div style={styles.alertBox}>
          <span style={styles.alertIcon}>⚠</span>
          <div>
            <p style={styles.alertTitle}>
              {t("他のプラットフォームで", "其他平台發現")}
              <strong style={{ color: "#c0392b" }}>
                {" "}¥{(820000).toLocaleString()}{" "}
              </strong>
              {t("安い価格を発見", "更低價格")}
            </p>
            <p style={styles.alertSub}>
              {t("詳細を見るにはプランを購入してください", "購買方案後查看詳細")}
            </p>
          </div>
        </div>
        <div style={styles.blurredPlatforms}>
          {["athome", "HOME'S", "不動産ジャパン"].map(p => (
            <div key={p} style={styles.platformRow}>
              <span style={styles.platformName}>{p}</span>
              <span style={styles.blurredPrice}>¥██,███,███</span>
            </div>
          ))}
        </div>
      </Section>

      {/* レポートプレビュー（ぼかし） */}
      <Section title={t("AI 分析レポート", "AI 分析報告")}>
        <div style={styles.reportPreview}>
          <p style={styles.reportPreviewTitle}>
            {t("レポート内容（購入後に閲覧可能）", "報告內容（購買後可查看）")}
          </p>
          {[90, 70, 80, 60, 75].map((w, i) => (
            <div key={i} style={{ ...styles.skeletonLine, width: `${w}%` }} />
          ))}
          <div style={styles.riskRowBlurred}>
            <div style={styles.riskCircleUnknown}>?</div>
            <span style={styles.riskLabelText}>
              {t("リスク評価：中程度（詳細は非表示）", "風險評估：中等風險（詳細隱藏）")}
            </span>
          </div>
        </div>
      </Section>

      <button
        style={styles.primaryBtn}
        onClick={() => chrome.tabs.create({ url: "https://bukken.io/pricing" })}
      >
        {t("プランを購入して解析する →", "購買方案開始分析 →")}
      </button>
      <button style={styles.ghostBtn}>
        {t("不動産会社に無料で問い合わせる", "免費詢問房仲")}
      </button>
    </div>
  )
}

// ── Paid view（ログインユーザー）────────────────────────────────────────────

function PaidView({ property, cross, crossSearch, crossSearching, report, reportState, points, onGenerateReport, t }: {
  property: PropertyData
  cross: CrossPlatformResult | null
  crossSearch: PlatformSearchResult[] | null
  crossSearching: boolean
  report: ReportContent | null
  reportState: ReportState
  points: number
  onGenerateReport: (type: "quick_summary" | "standard_report" | "deep_report") => void
  t: (ja: string, zh: string) => string
}) {
  return (
    <div style={styles.content}>
      <PropertySummary property={property} t={t} />

      {/* クロスプラットフォーム比較（バックエンド） */}
      {cross?.otherListings && cross.otherListings.length > 0 && (
        <Section title={t("価格差分析", "價格差異分析")} badge={t("無料", "免費")}>
          {(cross.priceDiff ?? 0) > 0 && (
            <div style={styles.savingsAlert}>
              {t("最安値は", "最低價在")} <strong>{cross.lowestPlatform}</strong>{" "}
              — <strong style={{ color: "#0F6E56" }}>¥{cross.priceDiff.toLocaleString()}</strong>{" "}
              {t("安い", "更便宜")}
            </div>
          )}
          {cross.otherListings.map(l => (
            <div key={l.platform} style={styles.platformRow}>
              <span style={styles.platformName}>{l.platform}</span>
              <span style={{ ...styles.platformPrice, color: l.price < (cross.currentPrice ?? 0) ? "#0F6E56" : "inherit" }}>
                ¥{l.price.toLocaleString()}{l.price < (cross.currentPrice ?? 0) && " ↓"}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* 他プラットフォーム検索結果 */}
      <Section title={t("他サイトで検索", "搜尋其他網站")} badge={t("無料", "免費")}>
        {crossSearching && (
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={styles.spinner} />
            <p style={styles.mutedText}>{t("各サイトを検索中...", "搜尋各平台中...")}</p>
          </div>
        )}
        {crossSearch && crossSearch.map(platform => (
          <div key={platform.platform}>
            <div style={styles.platformGroupHeader}>
              <span style={styles.platformGroupLabel}>{platform.platformLabel}</span>
              <a href={platform.url} target="_blank" rel="noreferrer" style={styles.platformLink}>
                {t("検索結果を見る →", "查看搜尋結果 →")}
              </a>
            </div>
            {platform.listings.length === 0 ? (
              <p style={{ ...styles.mutedText, padding: "0 14px 8px" }}>
                {t("上のリンクから検索結果をご確認ください", "請從上方連結查看搜尋結果")}
              </p>
            ) : (
              platform.listings.map((listing, i) => (
                <a key={i} href={listing.url} target="_blank" rel="noreferrer" style={styles.listingRow}>
                  <div style={styles.listingInfo}>
                    <span style={styles.listingName}>{listing.name || t("物件", "物件")}</span>
                  </div>
                  <span style={{
                    ...styles.listingPrice,
                    color: listing.price > 0 && listing.price < property.price ? "#0F6E56" : "#185FA5",
                  }}>
                    {listing.price > 0 ? `¥${listing.price.toLocaleString()}` : listing.priceText}
                    {listing.price > 0 && listing.price < property.price && (
                      <span style={styles.cheaperBadge}>{t("安い", "較低")}</span>
                    )}
                  </span>
                </a>
              ))
            )}
          </div>
        ))}
        {!crossSearching && !crossSearch && (
          <p style={{ ...styles.mutedText, padding: "10px 14px" }}>
            {t("物件を選択すると自動検索します", "選擇物件後自動搜尋")}
          </p>
        )}
      </Section>

      {/* AI レポート */}
      <Section title={t("AI 分析レポート", "AI 分析報告")}>
        {reportState === "none" && (
          <div style={styles.reportActions}>
            <button
              style={styles.reportBtn}
              onClick={() => onGenerateReport("quick_summary")}
              disabled={points < POINT_COSTS.quick_summary}
            >
              <span>{t("クイックサマリー", "快速摘要")}</span>
              <span style={styles.ptBadgeAmber}>{POINT_COSTS.quick_summary} pt</span>
            </button>
            <button
              style={{ ...styles.reportBtn, ...styles.reportBtnPrimary }}
              onClick={() => onGenerateReport("standard_report")}
              disabled={points < POINT_COSTS.standard_report}
            >
              <span>{t("標準レポート", "標準報告")}</span>
              <span style={styles.ptBadgeBlue}>{POINT_COSTS.standard_report} pt</span>
            </button>
            <button
              style={styles.reportBtn}
              onClick={() => onGenerateReport("deep_report")}
              disabled={points < POINT_COSTS.deep_report}
            >
              <span>{t("深度盡調レポート", "深度盡調報告")}</span>
              <span style={styles.ptBadgeAmber}>{POINT_COSTS.deep_report} pt</span>
            </button>
          </div>
        )}

        {reportState === "generating" && (
          <div style={styles.generatingWrap}>
            <div style={styles.spinner} />
            <p style={styles.mutedText}>{t("AI が分析中...", "AI 分析中...")}</p>
          </div>
        )}

        {reportState === "done" && report && (
          <ReportView report={report} t={t} />
        )}

        {reportState === "error" && (
          <div style={styles.errorBox}>
            {t("レポートの生成に失敗しました。再度お試しください。", "報告生成失敗，請再試一次。")}
          </div>
        )}
      </Section>

      <button style={styles.ghostBtn}>
        {t("不動産会社に無料で問い合わせる", "免費詢問房仲")}
      </button>
    </div>
  )
}

// ── Report view ──────────────────────────────────────────────────────────────

function ReportView({ report, t }: {
  report: ReportContent
  t: (ja: string, zh: string) => string
}) {
  const ai = report.aiAnalysis
  const risk = report.disasterRisk
  const market = report.areaMarket
  const zoning = report.zoning
  const landPrice = report.officialLandPrice

  return (
    <div style={styles.reportWrap}>
      {/* スコア */}
      {ai.investmentScore !== undefined && (
        <div style={styles.scoreRow}>
          <div style={{
            ...styles.scoreCircle,
            borderColor: ai.investmentScore >= 70 ? "#0F6E56"
              : ai.investmentScore >= 40 ? "#BA7517" : "#A32D2D",
          }}>
            <span style={styles.scoreNum}>{ai.investmentScore}</span>
          </div>
          <div>
            <p style={styles.scoreLabel}>{t("投資スコア", "投資評分")}</p>
            <p style={styles.scoreSub}>{t("100点満点", "滿分 100")}</p>
          </div>
        </div>
      )}

      {/* サマリー */}
      <p style={styles.summaryText}>{ai.summary}</p>

      {/* 市場データ */}
      {market && (
        <div style={styles.marketGrid}>
          <MarketCard
            label={t("坪単価（㎡）", "每坪單價")}
            value={`¥${market.avgPricePerSqm.toLocaleString()}`}
          />
          {market.estimatedRent && (
            <MarketCard
              label={t("推定賃料", "估計租金")}
              value={`¥${market.estimatedRent.toLocaleString()}/月`}
            />
          )}
          {market.estimatedYield && (
            <MarketCard
              label={t("推定利回り", "估計租報率")}
              value={`${market.estimatedYield.toFixed(1)}%`}
            />
          )}
          <MarketCard
            label={t("6ヶ月価格変動", "6個月漲跌")}
            value={`${market.priceChange6m > 0 ? "+" : ""}${market.priceChange6m.toFixed(1)}%`}
            valueColor={market.priceChange6m > 0 ? "#0F6E56" : "#A32D2D"}
          />
        </div>
      )}

      {/* 深度レポート専用: 用途地域 */}
      {zoning && (
        <div style={styles.riskSection}>
          <p style={styles.riskSectionTitle}>{t("用途地域", "用途地域")}</p>
          <div style={styles.marketGrid}>
            <MarketCard
              label={t("地域区分", "區域類別")}
              value={zoning.category}
            />
            {zoning.buildingCoverageRatio !== undefined && (
              <MarketCard
                label={t("建蔽率", "建蔽率")}
                value={`${zoning.buildingCoverageRatio}%`}
              />
            )}
            {zoning.floorAreaRatio !== undefined && (
              <MarketCard
                label={t("容積率", "容積率")}
                value={`${zoning.floorAreaRatio}%`}
              />
            )}
            {zoning.fireZone && zoning.fireZone !== "none" && (
              <MarketCard
                label={t("防火区分", "防火分區")}
                value={zoning.fireZone === "fire"
                  ? t("防火地域", "防火地域")
                  : t("準防火地域", "準防火地域")}
              />
            )}
          </div>
        </div>
      )}

      {/* 深度レポート専用: 公示地価 */}
      {landPrice && (
        <div style={styles.riskSection}>
          <p style={styles.riskSectionTitle}>
            {t(`公示地価（${landPrice.distanceToSiteM}m 地点）`, `公示地價（${landPrice.distanceToSiteM}m 參考點）`)}
          </p>
          <div style={styles.marketGrid}>
            <MarketCard
              label={t(`${landPrice.year}年 円/㎡`, `${landPrice.year}年 円/㎡`)}
              value={`¥${landPrice.pricePerSqm.toLocaleString()}`}
            />
            {landPrice.useCategory && (
              <MarketCard
                label={t("用途", "用途")}
                value={landPrice.useCategory}
              />
            )}
            {landPrice.nearestStation && (
              <MarketCard
                label={t("最寄駅", "最近車站")}
                value={landPrice.distanceToStationM
                  ? `${landPrice.nearestStation}(${landPrice.distanceToStationM}m)`
                  : landPrice.nearestStation}
              />
            )}
          </div>
        </div>
      )}

      {/* 災害リスク */}
      {risk && (
        <div style={styles.riskSection}>
          <p style={styles.riskSectionTitle}>{t("災害リスク", "災害風險")}</p>
          <div style={styles.riskGrid}>
            <RiskItem
              label={t("地震（30年）", "地震（30年）")}
              value={risk.earthquake30yr != null
                ? `${(risk.earthquake30yr * 100).toFixed(0)}%`
                : t("データなし", "資料無")}
              level={risk.earthquake30yr == null ? "mid"
                : risk.earthquake30yr > 0.6 ? "high"
                : risk.earthquake30yr > 0.3 ? "mid"
                : "low"}
            />
            <RiskItem
              label={t("洪水", "水災")}
              value={risk.floodRisk}
              level={risk.floodRisk === "high" || risk.floodRisk === "very_high" ? "high"
                : risk.floodRisk === "medium" ? "mid" : "low"}
            />
            <RiskItem
              label={t("土砂", "土砂")}
              value={risk.landslideRisk}
              level={risk.landslideRisk === "high" ? "high"
                : risk.landslideRisk === "medium" ? "mid" : "low"}
            />
            <RiskItem
              label={t("津波", "海嘯")}
              value={risk.tsunamiRisk}
              level={risk.tsunamiRisk === "high" ? "high"
                : risk.tsunamiRisk === "medium" ? "mid" : "low"}
            />
          </div>
        </div>
      )}

      {/* メリット・デメリット */}
      <div style={styles.prosConsWrap}>
        <div>
          <p style={styles.prosTitle}>{t("メリット", "優點")}</p>
          {ai.pros.map((p, i) => (
            <div key={i} style={styles.proItem}>
              <span style={styles.proIcon}>✓</span>
              <span style={styles.proText}>{p}</span>
            </div>
          ))}
        </div>
        <div>
          <p style={styles.consTitle}>{t("デメリット", "缺點")}</p>
          {ai.cons.map((c, i) => (
            <div key={i} style={styles.conItem}>
              <span style={styles.conIcon}>✕</span>
              <span style={styles.conText}>{c}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 推奨事項 */}
      <div style={styles.recommendBox}>
        <p style={styles.recommendLabel}>{t("アドバイス", "建議")}</p>
        <p style={styles.recommendText}>{ai.recommendation}</p>
      </div>

      <button style={styles.ghostBtn}>{t("PDF でダウンロード（1pt）", "PDF 下載（1pt）")}</button>
    </div>
  )
}

// ── Small components ─────────────────────────────────────────────────────────

function PropertySummary({ property, t }: {
  property: PropertyData
  t: (ja: string, zh: string) => string
}) {
  return (
    <div style={styles.propSummary}>
      <p style={styles.propName}>{property.name ?? property.address}</p>
      <p style={styles.propAddress}>{property.address}</p>
      <div style={styles.propMeta}>
        <span style={styles.propPrice}>¥{property.price.toLocaleString()}</span>
        {property.area && <span style={styles.propTag}>{property.area}㎡</span>}
        {property.age !== undefined && (
          <span style={styles.propTag}>{t(`築${property.age}年`, `屋齡 ${property.age} 年`)}</span>
        )}
      </div>
      {property.transport?.[0] && (
        <p style={styles.propTransport}>🚉 {property.transport[0]}</p>
      )}
    </div>
  )
}

function Section({ title, badge, children }: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <p style={styles.sectionTitle}>{title}</p>
        {badge && <span style={styles.freeBadge}>{badge}</span>}
      </div>
      {children}
    </div>
  )
}

function MarketCard({ label, value, valueColor }: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div style={styles.marketCard}>
      <p style={styles.marketLabel}>{label}</p>
      <p style={{ ...styles.marketValue, color: valueColor ?? "inherit" }}>{value}</p>
    </div>
  )
}

function RiskItem({ label, value, level }: {
  label: string
  value: string
  level: "low" | "mid" | "high"
}) {
  const color = level === "high" ? "#A32D2D" : level === "mid" ? "#BA7517" : "#0F6E56"
  const bg    = level === "high" ? "#FCEBEB" : level === "mid" ? "#FAEEDA" : "#E1F5EE"
  return (
    <div style={{ ...styles.riskItem, background: bg }}>
      <p style={styles.riskItemLabel}>{label}</p>
      <p style={{ ...styles.riskItemValue, color }}>{value}</p>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 360,
    minHeight: "100vh",
    background: "#FAFAF8",
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    fontSize: 13,
    color: "#1a1a1a",
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
  headerLeft: { display: "flex", alignItems: "baseline", gap: 0 },
  logo: { fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", color: "#1a1a1a" },
  logoDot: { fontSize: 18, fontWeight: 700, color: "#185FA5" },
  logoIo: { fontSize: 16, fontWeight: 700, color: "#185FA5" },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  localeBtn: {
    fontSize: 11, padding: "3px 8px",
    border: "0.5px solid #D3D1C7",
    borderRadius: 6, background: "transparent",
    color: "#5F5E5A", cursor: "pointer",
  },
  pointsBadge: {
    display: "flex", alignItems: "baseline", gap: 2,
    background: "#E1F5EE", borderRadius: 6,
    padding: "3px 8px",
  },
  pointsNum: { fontSize: 13, fontWeight: 600, color: "#085041" },
  pointsLabel: { fontSize: 10, color: "#0F6E56" },

  content: { padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 },

  idleWrap: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 12, padding: 32, color: "#888780",
  },
  idleIcon: { fontSize: 32 },
  idleText: { fontSize: 13, textAlign: "center", lineHeight: 1.6, color: "#888780" },

  spinner: {
    width: 24, height: 24,
    border: "2px solid #E0DED8",
    borderTop: "2px solid #185FA5",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  propSummary: {
    background: "#fff",
    border: "0.5px solid #E0DED8",
    borderRadius: 10,
    padding: "12px 14px",
  },
  propName: { fontSize: 14, fontWeight: 600, margin: "0 0 2px", lineHeight: 1.4 },
  propAddress: { fontSize: 11, color: "#888780", margin: "0 0 8px" },
  propMeta: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 },
  propPrice: { fontSize: 18, fontWeight: 700, color: "#185FA5", letterSpacing: "-0.02em" },
  propTag: {
    fontSize: 11, padding: "2px 7px",
    background: "#F1EFE8", borderRadius: 5,
    color: "#5F5E5A",
  },
  propTransport: { fontSize: 11, color: "#5F5E5A", margin: 0 },

  section: {
    background: "#fff",
    border: "0.5px solid #E0DED8",
    borderRadius: 10,
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px 8px",
    borderBottom: "0.5px solid #F1EFE8",
  },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: "#5F5E5A", margin: 0, letterSpacing: "0.05em", textTransform: "uppercase" },
  freeBadge: {
    fontSize: 10, padding: "2px 7px",
    background: "#E1F5EE", color: "#085041",
    borderRadius: 5,
  },

  alertBox: {
    margin: "8px 14px",
    padding: "10px 12px",
    background: "#FAEEDA",
    borderRadius: 8,
    display: "flex", gap: 8, alignItems: "flex-start",
  },
  alertIcon: { fontSize: 14, flexShrink: 0 },
  alertTitle: { fontSize: 12, fontWeight: 600, color: "#633806", margin: "0 0 2px" },
  alertSub: { fontSize: 11, color: "#854F0B", margin: 0 },

  blurredPlatforms: { padding: "4px 14px 12px" },
  platformRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "5px 0",
    borderBottom: "0.5px solid #F1EFE8",
  },
  platformName: { fontSize: 12, color: "#5F5E5A" },
  platformPrice: { fontSize: 12, fontWeight: 600 },
  blurredPrice: {
    fontSize: 12, color: "#B4B2A9",
    background: "#F1EFE8", borderRadius: 4,
    padding: "1px 8px", letterSpacing: "0.1em",
  },

  reportPreview: { padding: "8px 14px 12px" },
  reportPreviewTitle: { fontSize: 12, fontWeight: 500, color: "#5F5E5A", margin: "0 0 8px" },
  skeletonLine: {
    height: 8, background: "#F1EFE8",
    borderRadius: 4, marginBottom: 6,
  },
  riskRowBlurred: {
    display: "flex", alignItems: "center", gap: 8, marginTop: 10,
  },
  riskCircleUnknown: {
    width: 32, height: 32, borderRadius: "50%",
    background: "#F1EFE8", border: "2px solid #D3D1C7",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, color: "#B4B2A9", flexShrink: 0,
  },
  riskLabelText: { fontSize: 11, color: "#888780" },

  reportActions: { padding: "10px 14px 12px", display: "flex", gap: 8 },
  reportBtn: {
    flex: 1, padding: "9px 8px",
    border: "0.5px solid #D3D1C7",
    borderRadius: 8, background: "#FAFAF8",
    cursor: "pointer", fontSize: 12,
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: 4,
  },
  reportBtnPrimary: {
    border: "1.5px solid #185FA5",
    background: "#E6F1FB", color: "#185FA5",
  },
  ptBadgeAmber: {
    fontSize: 10, padding: "1px 6px",
    background: "#FAEEDA", color: "#633806",
    borderRadius: 4,
  },
  ptBadgeBlue: {
    fontSize: 10, padding: "1px 6px",
    background: "#185FA5", color: "#fff",
    borderRadius: 4,
  },

  generatingWrap: {
    padding: "16px 14px",
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: 8,
  },
  mutedText: { fontSize: 12, color: "#888780", margin: 0 },

  errorBox: {
    padding: "10px 14px",
    background: "#FCEBEB",
    fontSize: 12, color: "#A32D2D",
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
  },
  inlineLink: {
    background: "none", border: "none",
    color: "#185FA5", fontSize: 12,
    cursor: "pointer", padding: 0,
    textDecoration: "underline",
  },

  savingsAlert: {
    margin: "8px 14px 4px",
    padding: "8px 12px",
    background: "#E1F5EE", borderRadius: 8,
    fontSize: 12, color: "#085041",
  },

  platformGroupHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 14px 4px",
    borderTop: "0.5px solid #F1EFE8",
  },
  platformGroupLabel: { fontSize: 11, fontWeight: 600, color: "#5F5E5A" },
  platformLink: { fontSize: 10, color: "#185FA5", textDecoration: "none" },

  listingRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 14px",
    borderBottom: "0.5px solid #F1EFE8",
    textDecoration: "none", color: "inherit",
    cursor: "pointer",
  },
  listingInfo: { flex: 1, overflow: "hidden" },
  listingName: {
    fontSize: 11, color: "#2C2C2A",
    display: "block", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listingPrice: { fontSize: 12, fontWeight: 600, flexShrink: 0, marginLeft: 8 },
  cheaperBadge: {
    marginLeft: 4, fontSize: 9,
    background: "#E1F5EE", color: "#0F6E56",
    borderRadius: 4, padding: "1px 5px",
  },

  reportWrap: { padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: 12 },

  scoreRow: { display: "flex", alignItems: "center", gap: 12 },
  scoreCircle: {
    width: 52, height: 52, borderRadius: "50%",
    border: "3px solid", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  scoreNum: { fontSize: 18, fontWeight: 700 },
  scoreLabel: { fontSize: 12, fontWeight: 600, margin: "0 0 2px" },
  scoreSub: { fontSize: 10, color: "#888780", margin: 0 },

  summaryText: { fontSize: 12, lineHeight: 1.7, color: "#2C2C2A", margin: 0 },

  marketGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  marketCard: {
    background: "#F1EFE8", borderRadius: 8,
    padding: "8px 10px",
  },
  marketLabel: { fontSize: 10, color: "#888780", margin: "0 0 2px" },
  marketValue: { fontSize: 14, fontWeight: 700, margin: 0 },

  riskSection: {},
  riskSectionTitle: { fontSize: 11, fontWeight: 600, color: "#5F5E5A", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" },
  riskGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  riskItem: { borderRadius: 8, padding: "8px 10px" },
  riskItemLabel: { fontSize: 10, color: "#5F5E5A", margin: "0 0 2px" },
  riskItemValue: { fontSize: 13, fontWeight: 600, margin: 0 },

  prosConsWrap: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  prosTitle: { fontSize: 11, fontWeight: 600, color: "#0F6E56", margin: "0 0 6px" },
  consTitle: { fontSize: 11, fontWeight: 600, color: "#A32D2D", margin: "0 0 6px" },
  proItem: { display: "flex", gap: 5, marginBottom: 5 },
  conItem: { display: "flex", gap: 5, marginBottom: 5 },
  proIcon: { fontSize: 10, color: "#0F6E56", flexShrink: 0, marginTop: 2 },
  conIcon: { fontSize: 10, color: "#A32D2D", flexShrink: 0, marginTop: 2 },
  proText: { fontSize: 11, lineHeight: 1.5, color: "#2C2C2A" },
  conText: { fontSize: 11, lineHeight: 1.5, color: "#2C2C2A" },

  recommendBox: {
    background: "#E6F1FB",
    borderRadius: 8, padding: "10px 12px",
  },
  recommendLabel: { fontSize: 10, fontWeight: 600, color: "#185FA5", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" },
  recommendText: { fontSize: 12, lineHeight: 1.6, color: "#0C447C", margin: 0 },

  primaryBtn: {
    width: "100%", padding: "11px",
    background: "#185FA5", color: "#fff",
    border: "none", borderRadius: 8,
    fontSize: 13, fontWeight: 600,
    cursor: "pointer", letterSpacing: "0.01em",
  },
  ghostBtn: {
    width: "100%", padding: "10px",
    background: "transparent",
    border: "0.5px solid #D3D1C7",
    borderRadius: 8, color: "#5F5E5A",
    fontSize: 12, cursor: "pointer",
  },
}
