# Bukken.io — 開發進度（2026-04-20）

---

## 目前環境狀態

| 項目 | 狀態 | 備註 |
|------|------|------|
| Backend dev server | ✅ 運行中 | `http://localhost:3003` |
| Extension dev build | ✅ 運行中 | `extension/build/chrome-mv3-dev/` |
| Supabase DB | ✅ 已建立 | Tokyo region，migrations 已執行 |
| Anthropic API | ✅ 已設定 | `.env.local` 已填入 |
| Stripe | ❌ 未設定 | 日本法人開戶未完成 |
| SerpAPI | ❌ 未申請 | |
| reinfolib API Key | ❌ 未申請 | |
| FUDOSAN DB API Key | ❌ 已失效 | 需重新申請 |

---

## 已完成的程式碼

### shared/
```
shared/types/index.ts          ✅ Platform 含 suumo | athome | homes | rakumachi | kenbiya
```

### extension/
```
extension/public/manifest.json             ✅ 已移至 package.json manifest 設定
extension/package.json                     ✅ 含 permissions + host_permissions
extension/src/parsers/suumo.ts             ✅ SUUMO DOM 解析器
extension/src/parsers/athome.ts            ✅ athome DOM 解析器
extension/src/parsers/homes.ts             ✅ HOME'S DOM 解析器
extension/src/parsers/rakumachi.ts         ✅ 楽待 DOM 解析器（含利回り）
extension/src/parsers/kenbiya.ts           ✅ 健美家 DOM 解析器（含利回り）
extension/src/parsers/index.ts             ✅ 平台偵測 + 路由（5 平台）
extension/src/contents/index.ts            ✅ Plasmo Content Script（正確格式）
extension/src/background/index.ts          ✅ Service Worker（訊息路由 + 側邊欄）
extension/src/lib/api.ts                   ✅ 外掛→後端 API client（含 storage 防禦）
extension/src/lib/crossSearch.ts           ✅ 瀏覽器端跨平台搜尋（直接 fetch 各網站）
extension/src/sidepanel/index.tsx          ✅ 側邊欄 UI（含跨平台搜尋結果區塊）
extension/src/sidepanel/PricingPage.tsx    ✅ 點數購買頁
extension/src/sidepanel/LoginPage.tsx      ✅ Magic Link 登入頁
extension/assets/icon.png                  ✅ 外掛 icon（藍色圓角）
```

### backend/
```
backend/.env.local                              ✅ Supabase + Anthropic key 已填入

# API Routes
backend/src/app/api/report/create/route.ts     ✅ 報告生成（扣點 + Claude AI）
backend/src/app/api/report/[id]/route.ts       ✅ 永久 URL 報告取得
backend/src/app/api/points/purchase/route.ts   ✅ Stripe Checkout
backend/src/app/api/points/balance/route.ts    ✅ 點數餘額
backend/src/app/api/webhook/route.ts           ✅ Stripe Webhook（自動加點）
backend/src/app/api/search/cross-platform/route.ts ✅ 跨平台搜尋協調器
backend/src/app/api/analyze/image/route.ts     ✅ Claude Vision OCR
backend/src/app/api/analyze/url/route.ts       ✅ URL 解析

# Libraries
backend/src/lib/supabase/index.ts              ✅ Supabase client + 原子操作 RPC
backend/src/lib/supabase/migrations.sql        ✅ 已執行（含 agents/leads 順序修正）
backend/src/lib/supabase/migrations_search.sql ✅ 已執行
backend/src/lib/stripe/index.ts                ✅
backend/src/lib/apis/geocode.ts                ✅ 国土地理院（免費）
backend/src/lib/apis/jshis.ts                  ✅ J-SHIS 地震 API（免費）
backend/src/lib/apis/landprice.ts              ✅ 国交省 成約価格 API（免費・新規追加）
backend/src/lib/apis/reinfolib.ts              ✅ 国交省 防災 API（key 待申請）
backend/src/lib/apis/fudosandb.ts              ✅ FUDOSAN DB（key 失效中）
backend/src/lib/apis/oshimaland.ts             ✅ 大島てる（dry-run 模式）

# Services
backend/src/services/reportService.ts          ✅ レポート生成（含成約価格データ）
backend/src/services/discrepancyAnalyzer.ts    ✅ 落差分析エンジン
backend/src/services/layer3Search.ts           ✅ Google 拡大検索（SerpAPI 待申請）

# Pages
backend/src/app/report/[id]/page.tsx           ✅ 永久 URL 報告頁
backend/src/app/pricing/page.tsx               ✅ 定價頁
backend/src/app/purchase/success/page.tsx      ✅ 購買完成頁
backend/src/app/auth/callback/page.tsx         ✅ Magic Link callback
```

### website/
```
website/index.html    ✅ 官網首頁（URL 輸入 + 圖面上傳 + 住所輸入）
```

---

## 各 API 串接狀態

| API | 用途 | 狀態 |
|-----|------|------|
| 国土地理院 Geocoding | 住址→座標 | ✅ 免費・無需 key |
| J-SHIS | 地震風險（30年確率） | ✅ 免費・無需 key |
| 国交省 成約価格 | 附近實際成交價 | ✅ 免費・無需 key（本次新增）|
| 大島てる | 事故物件查詢 | ✅ dry-run 模式（許諾前）|
| Supabase | DB + Auth | ✅ 已設定 |
| Anthropic Claude | AI 報告生成 | ✅ key 已設定 |
| 国交省 reinfolib | 洪水・土砂・津波防災 | ⚠️ key 未申請 |
| FUDOSAN DB | AI 賃料推定 | ⚠️ key 失效 |
| SerpAPI | Layer 3 Google 搜尋 | ⚠️ 未申請 |
| Stripe | 點數購買付款 | ⚠️ 未開戶 |

---

## 本次 Session 新增內容

1. **楽待・健美家 DOM parser** — 投資物件平台對應（含利回り欄位）
2. **Platform 型別擴充** — `shared/types` 加入 rakumachi | kenbiya
3. **国交省 成約価格 API（landprice.ts）** — 完全免費・無需 key，附近實際成交數據
4. **reportService 整合** — 成約價格加入 AI 報告 prompt
5. **瀏覽器端跨平台搜尋（crossSearch.ts）** — 從外掛直接 fetch 各平台搜尋結果，不需 SerpAPI
6. **Supabase 建立** — Tokyo region、migrations 執行、key 填入
7. **Extension 修正** — content script 移至 Plasmo 正確位置（`src/contents/`）、permissions 修正、storage 防禦性處理
8. **migrations.sql bug 修正** — `agents` 表順序移至 `leads` 之前（FK 問題）

---

## 待辦事項（依優先順序）

### 立刻可做
- [ ] Chrome 外掛載入測試 — SUUMO 物件頁側邊欄是否正常彈出
- [ ] 跨平台搜尋結果驗證 — 各平台能否取得物件資料

### 需申請帳號
- [ ] **reinfolib API Key** — 防災資料（洪水・土砂・津波）
- [ ] **SerpAPI 或 Brave Search** — Layer 3 Google 搜尋
- [ ] **Stripe** — 日本法人（J&E 株式会社）開戶
- [ ] **Chrome Web Store** — 開發者帳號（上架用）
- [ ] **FUDOSAN DB** — 重新申請 API key

### 上線前
- [ ] Supabase Auth redirect URL 設定（bukken.io/auth/callback）
- [ ] Vercel 部署 backend
- [ ] 大島てる 正式許諾取得（`OSHIMA_DRY_RUN=false`）
- [ ] 深度報告（30pt）— 路線価 + 用途地域
- [ ] J&E 管理現場洞察規則（Erin 提供 10 條）

---

## 環境變數（backend/.env.local）

```
SUPABASE_URL=https://geuesgeeolsxiwwkdlpb.supabase.co  ✅
SUPABASE_ANON_KEY=                                       ✅ 已填
SUPABASE_SERVICE_ROLE_KEY=                               ✅ 已填
NEXT_PUBLIC_SUPABASE_URL=                                ✅ 已填
NEXT_PUBLIC_SUPABASE_ANON_KEY=                           ✅ 已填
ANTHROPIC_API_KEY=                                       ✅ 已填
STRIPE_SECRET_KEY=                                       ❌ 未設定
STRIPE_WEBHOOK_SECRET=                                   ❌ 未設定
REINFOLIB_API_KEY=                                       ❌ 未申請
FUDOSAN_DB_API_KEY=                                      ❌ 失效
SERP_API_KEY=                                            ❌ 未申請
OSHIMA_DRY_RUN=true                                      ✅
NEXT_PUBLIC_APP_URL=http://localhost:3003                ✅
```
