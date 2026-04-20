# Bukken.io 🏠

> 日本不動産クロスプラットフォーム分析 Chrome 拡張機能

## 構成

```
bukken-io/
├── extension/        # Chrome 拡張（Plasmo + React）
├── backend/          # API サーバー（Next.js + Vercel）
└── shared/           # 共通型定義
```

## セットアップ

### 1. 環境変数

```bash
cp backend/.env.example backend/.env.local
# .env.local に各 API Key を設定
```

### 2. Supabase マイグレーション

Supabase Dashboard → SQL Editor で以下を実行:
```
backend/src/lib/supabase/migrations.sql
```

### 3. バックエンド起動

```bash
cd backend
npm install
npm run dev
```

### 4. 拡張機能開発

```bash
cd extension
npm install
npm run dev
# Chrome で chrome://extensions → デベロッパーモード → build/chrome-mv3-dev を読み込む
```

## 対応プラットフォーム（MVP）

- [x] SUUMO
- [x] athome
- [ ] HOME'S（次バージョン）

## ポイント消費

| 機能 | ポイント |
|------|---------|
| クロスプラットフォーム比較 | 0（会員特典） |
| クイックサマリー | 6 |
| 標準 AI レポート | 10 |
| 深度デューデリジェンス | 30 |
| PDF ダウンロード | 1 |

## 申請が必要な API

- [ ] 不動産情報ライブラリ API Key → reinfolib.mlit.go.jp/api/request/
- [x] FUDOSAN DB API Key（取得済み・要更新）
- J-SHIS、国土地理院 → 申請不要

## 技術スタック

| 用途 | 技術 |
|------|------|
| 拡張機能 | Plasmo + React + TypeScript |
| バックエンド | Next.js App Router + Vercel |
| データベース | Supabase (PostgreSQL) |
| AI | Claude API (Sonnet) |
| 決済 | Stripe (JPY) |
| 物件検索 | SerpAPI |
