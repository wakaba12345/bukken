/**
 * /report/[id] — 永久URL 物件レポートページ
 * ==========================================
 * bukken.io/report/:id で公開される SSR ページ。
 * cross-platform 検索結果を表示し、シェア・AI レポート購入へ誘導する。
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─── 型定義 ───────────────────────────────────────────────────────────────────

interface Source {
  url: string
  platform: string
  name?: string
  address: string
  price: number
  area: number
  age?: number
  floor?: string
  managementFee?: number
  transport?: string[]
}

interface Discrepancy {
  type: string
  severity: 'info' | 'caution' | 'warning'
  interpretation: string
  interpretationZh: string
  actionAdvice: string
  values: Record<string, string | number>
}

interface PlatformMatch {
  platform: string
  url: string
  price: number
}

interface CrossAnalysis {
  discrepancies: Discrepancy[]
  lowestPrice: number
  lowestPlatform: string
  totalPriceDiff: number
  confidenceScore: number
  summary: string
  summaryZh: string
  matches: PlatformMatch[]
}

interface ResultData {
  source: Source
  crossAnalysis?: CrossAnalysis
  earthquakeRisk?: { prob30yr6Strong: number } | null
  disasterRisk?: { floodRisk: string; landslideRisk: string; tsunamiRisk: string } | null
  areaMarket?: {
    avgPricePerSqm: number
    estimatedRent?: number
    estimatedYield?: number
    priceChange6m: number
  } | null
  oshima?: { found: boolean; isDryRun: boolean; incidents?: { description: string }[] } | null
  layer3?: {
    summary: string
    buildingIssues: number
    managementIssues: number
    issues?: { type: string; severity: string; title: string; snippet: string; url: string }[]
  } | null
}

interface SearchResult {
  id: string
  result_data: ResultData
  property_name: string | null
  property_address: string | null
  has_issues: boolean
  issue_count: number
  created_at: string
}

// ─── メタデータ（OG タグ） ────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params
  const { data } = await supabase
    .from('search_results')
    .select('property_name, property_address, has_issues, result_data')
    .eq('id', id)
    .eq('is_public', true)
    .single<SearchResult>()

  if (!data) return { title: 'Bukken.io — 物件レポート' }

  const src = data.result_data?.source
  const name = data.property_name ?? src?.name ?? src?.address ?? '物件'
  const address = data.property_address ?? src?.address ?? ''
  const price = src?.price ? `¥${src.price.toLocaleString()}` : ''
  const warning = data.has_issues ? ' ⚠ 注意事項あり' : ''

  const title = `${name} — bukken.io レポート`
  const description = [address, price, warning].filter(Boolean).join(' | ')

  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Bukken.io', type: 'article' },
    twitter: { card: 'summary', title, description },
  }
}

// ─── ページ本体 ───────────────────────────────────────────────────────────────

export default async function ReportPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data: result } = await supabase
    .from('search_results')
    .select('*')
    .eq('id', id)
    .eq('is_public', true)
    .single<SearchResult>()

  if (!result) notFound()

  const d = result.result_data
  const src = d.source
  const cross = d.crossAnalysis
  const eq = d.earthquakeRisk
  const dis = d.disasterRisk
  const market = d.areaMarket
  const oshima = d.oshima
  const layer3 = d.layer3

  const createdAt = new Date(result.created_at).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={s.header}>
        <a href="https://bukken.io" style={s.logoWrap}>
          <span style={s.logo}>bukken</span>
          <span style={s.logoDot}>.</span>
          <span style={s.logoIo}>io</span>
        </a>
        <span style={s.headerLabel}>物件レポート</span>
      </div>

      <div style={s.container}>

        {/* ── 物件サマリー ── */}
        <div style={s.card}>
          <div style={s.propMeta}>
            <span style={s.platformBadge}>{src.platform}</span>
            {src.age !== undefined && <span style={s.ageBadge}>築{src.age}年</span>}
            {result.has_issues && (
              <span style={s.warningBadge}>⚠ 注意事項あり</span>
            )}
          </div>
          <h1 style={s.propName}>{src.name ?? src.address}</h1>
          <p style={s.propAddress}>{src.address}</p>
          <div style={s.priceRow}>
            <span style={s.price}>¥{src.price.toLocaleString()}</span>
            {src.area > 0 && <span style={s.tag}>{src.area}㎡</span>}
            {src.floor && <span style={s.tag}>{src.floor}</span>}
          </div>
          {src.transport?.[0] && (
            <p style={s.transport}>🚉 {src.transport[0]}</p>
          )}
          {src.managementFee !== undefined && (
            <p style={s.manageFee}>管理費 ¥{src.managementFee.toLocaleString()}/月</p>
          )}
          <a href={src.url} target="_blank" rel="noreferrer" style={s.srcLink}>
            元の物件ページを開く →
          </a>
        </div>

        {/* ── クロスプラットフォーム分析 ── */}
        {cross && (
          <div style={s.card}>
            <SectionTitle>クロスプラットフォーム分析</SectionTitle>

            {cross.totalPriceDiff > 0 && (
              <div style={{ ...s.alertBox, background: '#FAEEDA', borderLeft: '3px solid #BA7517' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#633806' }}>
                  {cross.lowestPlatform} が最安値 —{' '}
                  <span style={{ color: '#A32D2D' }}>¥{cross.totalPriceDiff.toLocaleString()}</span> 安い
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#854F0B' }}>
                  信頼スコア: {cross.confidenceScore}/100
                </p>
              </div>
            )}

            {cross.discrepancies.length > 0 ? (
              <div style={s.discList}>
                {cross.discrepancies.map((disc, i) => (
                  <div key={i} style={{
                    ...s.discItem,
                    background: disc.severity === 'warning' ? '#FCEBEB'
                      : disc.severity === 'caution' ? '#FAEEDA' : '#E6F1FB',
                    borderLeft: `3px solid ${disc.severity === 'warning' ? '#A32D2D'
                      : disc.severity === 'caution' ? '#BA7517' : '#185FA5'}`,
                  }}>
                    <p style={{
                      ...s.discType,
                      color: disc.severity === 'warning' ? '#A32D2D'
                        : disc.severity === 'caution' ? '#BA7517' : '#185FA5',
                    }}>
                      {disc.type.replace(/_/g, ' ')}
                    </p>
                    <p style={s.discText}>{disc.interpretation}</p>
                    {disc.actionAdvice && (
                      <p style={s.discAdvice}>→ {disc.actionAdvice}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={s.muted}>{cross.summary}</p>
            )}

            {cross.matches.length > 0 && (
              <div style={s.matchTable}>
                <p style={s.matchTableLabel}>他プラットフォームの掲載</p>
                {cross.matches.map(m => (
                  <div key={m.platform} style={s.matchRow}>
                    <span style={s.matchPlatform}>{m.platform}</span>
                    <a href={m.url} target="_blank" rel="noreferrer" style={s.matchPrice}>
                      ¥{m.price.toLocaleString()} →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 災害リスク ── */}
        {(eq || dis) && (
          <div style={s.card}>
            <SectionTitle>災害リスク</SectionTitle>
            <div style={s.riskGrid}>
              {eq && (
                <RiskCard
                  label="地震（30年・震度6強）"
                  value={`${(eq.prob30yr6Strong * 100).toFixed(0)}%`}
                  level={eq.prob30yr6Strong > 0.6 ? 'high' : eq.prob30yr6Strong > 0.3 ? 'mid' : 'low'}
                />
              )}
              {dis?.floodRisk && dis.floodRisk !== 'none' && (
                <RiskCard
                  label="洪水リスク"
                  value={dis.floodRisk}
                  level={['high', 'very_high'].includes(dis.floodRisk) ? 'high'
                    : dis.floodRisk === 'medium' ? 'mid' : 'low'}
                />
              )}
              {dis?.landslideRisk && dis.landslideRisk !== 'none' && (
                <RiskCard
                  label="土砂崩れ"
                  value={dis.landslideRisk}
                  level={dis.landslideRisk === 'high' ? 'high'
                    : dis.landslideRisk === 'medium' ? 'mid' : 'low'}
                />
              )}
              {dis?.tsunamiRisk && dis.tsunamiRisk !== 'none' && (
                <RiskCard
                  label="津波"
                  value={dis.tsunamiRisk}
                  level={dis.tsunamiRisk === 'high' ? 'high'
                    : dis.tsunamiRisk === 'medium' ? 'mid' : 'low'}
                />
              )}
            </div>
          </div>
        )}

        {/* ── エリア市況 ── */}
        {market && (
          <div style={s.card}>
            <SectionTitle>エリア市況</SectionTitle>
            <div style={s.marketGrid}>
              <MarketCard label="平均坪単価（㎡）" value={`¥${market.avgPricePerSqm.toLocaleString()}`} />
              {market.estimatedRent && (
                <MarketCard label="推定賃料" value={`¥${market.estimatedRent.toLocaleString()}/月`} />
              )}
              {market.estimatedYield && (
                <MarketCard label="推定利回り" value={`${market.estimatedYield.toFixed(1)}%`} />
              )}
              <MarketCard
                label="6ヶ月価格変動"
                value={`${market.priceChange6m > 0 ? '+' : ''}${market.priceChange6m.toFixed(1)}%`}
                valueColor={market.priceChange6m > 0 ? '#0F6E56' : '#A32D2D'}
              />
            </div>
          </div>
        )}

        {/* ── 事故物件チェック ── */}
        {oshima && !oshima.isDryRun && (
          <div style={{ ...s.card, borderColor: oshima.found ? '#e8b4b4' : '#D3D1C7' }}>
            <SectionTitle>事故物件チェック（大島てる）</SectionTitle>
            {oshima.found ? (
              <div style={{ ...s.alertBox, background: '#FCEBEB', borderLeft: '3px solid #A32D2D' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#A32D2D' }}>
                  ⚠ この物件は事故物件の可能性があります
                </p>
                {oshima.incidents?.map((inc, i) => (
                  <p key={i} style={{ margin: '4px 0 0', fontSize: 12, color: '#7A2020' }}>
                    {inc.description}
                  </p>
                ))}
              </div>
            ) : (
              <p style={{ ...s.muted, color: '#0F6E56' }}>✓ 事故物件の記録なし</p>
            )}
          </div>
        )}

        {/* ── 拡大検索（管理問題・報道） ── */}
        {layer3 && ((layer3.issues?.length ?? 0) > 0 || layer3.buildingIssues > 0 || layer3.managementIssues > 0) && (
          <div style={s.card}>
            <SectionTitle>拡大検索（管理問題・報道記事）</SectionTitle>
            <p style={s.muted}>{layer3.summary}</p>
            {layer3.issues?.slice(0, 5).map((issue, i) => (
              <div key={i} style={{
                ...s.discItem,
                background: issue.severity === 'high' ? '#FCEBEB' : '#FAEEDA',
                borderLeft: `3px solid ${issue.severity === 'high' ? '#A32D2D' : '#BA7517'}`,
                marginTop: 8,
              }}>
                <p style={{ ...s.discType, color: issue.severity === 'high' ? '#A32D2D' : '#BA7517' }}>
                  {issue.type}
                </p>
                <p style={s.discText}>{issue.title}</p>
                <p style={s.discAdvice}>{issue.snippet}</p>
                <a href={issue.url} target="_blank" rel="noreferrer" style={s.srcLink}>
                  ソースを確認 →
                </a>
              </div>
            ))}
          </div>
        )}

        {/* ── AI レポート CTA ── */}
        <div style={s.ctaCard}>
          <p style={s.ctaTitle}>より詳しい AI 分析レポートを取得する</p>
          <p style={s.ctaSub}>
            投資スコア・交渉アドバイス・詳細リスク評価を含む AI レポート（10 pt）<br />
            標準レポートは 10 pt で生成できます
          </p>
          <div style={s.ctaBtns}>
            <a href="https://bukken.io/pricing" style={s.ctaBtnPrimary}>
              ポイントを購入 →
            </a>
            <a href="https://chromewebstore.google.com" target="_blank" rel="noreferrer" style={s.ctaBtnGhost}>
              Chrome 拡張機能をインストール
            </a>
          </div>
        </div>

        <p style={s.timestamp}>
          生成: {createdAt} JST &nbsp;|&nbsp; Powered by bukken.io
        </p>

      </div>
    </div>
  )
}

// ─── 小コンポーネント ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p style={s.sectionTitle}>{children}</p>
}

function RiskCard({ label, value, level }: { label: string; value: string; level: 'low' | 'mid' | 'high' }) {
  const color = level === 'high' ? '#A32D2D' : level === 'mid' ? '#BA7517' : '#0F6E56'
  const bg    = level === 'high' ? '#FCEBEB' : level === 'mid' ? '#FAEEDA' : '#E1F5EE'
  return (
    <div style={{ ...s.riskCard, background: bg }}>
      <p style={s.riskLabel}>{label}</p>
      <p style={{ ...s.riskValue, color }}>{value}</p>
    </div>
  )
}

function MarketCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={s.marketCard}>
      <p style={s.marketLabel}>{label}</p>
      <p style={{ ...s.marketValue, color: valueColor ?? 'inherit' }}>{value}</p>
    </div>
  )
}

// ─── スタイル ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#FAFAF8',
    fontFamily: "'Noto Sans JP', 'PingFang TC', sans-serif",
    color: '#1a1a1a',
    fontSize: 14,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 24px',
    background: '#fff',
    borderBottom: '0.5px solid #E0DED8',
    position: 'sticky', top: 0, zIndex: 10,
  },
  logoWrap: { display: 'flex', alignItems: 'baseline', textDecoration: 'none' },
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a1a' },
  logoDot: { fontSize: 22, fontWeight: 700, color: '#185FA5' },
  logoIo: { fontSize: 20, fontWeight: 700, color: '#185FA5' },
  headerLabel: { fontSize: 12, color: '#888780' },

  container: {
    maxWidth: 720, margin: '0 auto',
    padding: '28px 20px 80px',
    display: 'flex', flexDirection: 'column', gap: 14,
  },

  card: {
    background: '#fff',
    border: '0.5px solid #E0DED8',
    borderRadius: 12,
    padding: '20px 24px',
  },

  propMeta: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  platformBadge: {
    fontSize: 11, padding: '2px 8px',
    background: '#E6F1FB', color: '#185FA5',
    borderRadius: 5, fontWeight: 500,
  },
  ageBadge: {
    fontSize: 11, padding: '2px 8px',
    background: '#F1EFE8', color: '#5F5E5A',
    borderRadius: 5,
  },
  warningBadge: {
    fontSize: 11, padding: '2px 8px',
    background: '#FCEBEB', color: '#A32D2D',
    borderRadius: 5, fontWeight: 500,
  },
  propName: {
    fontSize: 22, fontWeight: 700, margin: '0 0 4px',
    letterSpacing: '-0.01em', lineHeight: 1.3,
  },
  propAddress: { fontSize: 13, color: '#888780', margin: '0 0 12px' },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  price: { fontSize: 28, fontWeight: 700, color: '#185FA5', letterSpacing: '-0.02em' },
  tag: {
    fontSize: 12, padding: '3px 8px',
    background: '#F1EFE8', borderRadius: 5, color: '#5F5E5A',
  },
  transport: { fontSize: 12, color: '#5F5E5A', margin: '4px 0 0' },
  manageFee: { fontSize: 12, color: '#888780', margin: '4px 0 0' },
  srcLink: { display: 'inline-block', marginTop: 12, fontSize: 12, color: '#185FA5', textDecoration: 'none' },

  sectionTitle: {
    fontSize: 11, fontWeight: 600, color: '#5F5E5A',
    margin: '0 0 14px', letterSpacing: '0.06em', textTransform: 'uppercase',
  },

  alertBox: { padding: '12px 14px', borderRadius: 8, marginBottom: 12 },

  discList: { display: 'flex', flexDirection: 'column', gap: 8 },
  discItem: { padding: '10px 14px', borderRadius: 8 },
  discType: {
    fontSize: 10, fontWeight: 700, margin: '0 0 4px',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  discText: { fontSize: 13, lineHeight: 1.65, margin: '0 0 4px', color: '#2C2C2A' },
  discAdvice: { fontSize: 11, color: '#5F5E5A', margin: 0, lineHeight: 1.5 },

  matchTable: { marginTop: 14, borderTop: '0.5px solid #F1EFE8', paddingTop: 10 },
  matchTableLabel: { fontSize: 11, color: '#888780', margin: '0 0 6px' },
  matchRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 0', borderBottom: '0.5px solid #F1EFE8',
  },
  matchPlatform: { fontSize: 12, color: '#5F5E5A' },
  matchPrice: { fontSize: 12, fontWeight: 600, color: '#185FA5', textDecoration: 'none' },

  riskGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  riskCard: { borderRadius: 8, padding: '10px 12px' },
  riskLabel: { fontSize: 11, color: '#5F5E5A', margin: '0 0 4px' },
  riskValue: { fontSize: 16, fontWeight: 700, margin: 0 },

  marketGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  marketCard: { background: '#F1EFE8', borderRadius: 8, padding: '10px 12px' },
  marketLabel: { fontSize: 11, color: '#888780', margin: '0 0 2px' },
  marketValue: { fontSize: 16, fontWeight: 700, margin: 0 },

  muted: { fontSize: 13, color: '#888780', margin: 0, lineHeight: 1.65 },

  ctaCard: {
    background: '#185FA5',
    borderRadius: 12, padding: '28px 24px',
    textAlign: 'center',
  },
  ctaTitle: { fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px' },
  ctaSub: { fontSize: 13, color: 'rgba(255,255,255,0.82)', margin: '0 0 20px', lineHeight: 1.7 },
  ctaBtns: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  ctaBtnPrimary: {
    background: '#fff', color: '#185FA5',
    padding: '11px 24px', borderRadius: 8,
    textDecoration: 'none', fontSize: 14, fontWeight: 600,
  },
  ctaBtnGhost: {
    background: 'transparent', color: '#fff',
    padding: '11px 24px', borderRadius: 8,
    textDecoration: 'none', fontSize: 14,
    border: '1px solid rgba(255,255,255,0.5)',
  },

  timestamp: { fontSize: 11, color: '#B4B2A9', textAlign: 'center', margin: 0 },
}
