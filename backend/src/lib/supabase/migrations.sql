-- ============================================================
-- Bukken.io Database Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Users (Supabase Auth を使用) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'ja' CHECK (locale IN ('ja', 'zh-TW')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT USING (auth.uid() = id);

-- ── Point accounts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS point_accounts (
  user_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance           INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE point_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own balance" ON point_accounts;
CREATE POLICY "Users can read own balance"
  ON point_accounts FOR SELECT USING (auth.uid() = user_id);

-- ── Point transactions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS point_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,          -- 正=加算, 負=消費
  feature     TEXT,                      -- 'standard_report', 'purchase_starter', etc.
  property_id UUID,
  plan_id     TEXT,                      -- 'starter', 'standard', 'pro', 'payg'
  stripe_session_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own transactions" ON point_transactions;
CREATE POLICY "Users can read own transactions"
  ON point_transactions FOR SELECT USING (auth.uid() = user_id);

-- ── Properties ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL,
  address     TEXT NOT NULL,
  lat         FLOAT,
  lng         FLOAT,
  price       BIGINT,                    -- 円
  area        FLOAT,                     -- ㎡
  age         INTEGER,                   -- 築年数
  name        TEXT,
  raw_data    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS properties_address_idx ON properties(address);
CREATE INDEX IF NOT EXISTS properties_lat_lng_idx ON properties(lat, lng);

-- ── Reports ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id),
  type        TEXT NOT NULL CHECK (type IN ('quick_summary', 'standard', 'deep')),
  content     JSONB NOT NULL,
  points_used INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own reports" ON reports;
CREATE POLICY "Users can read own reports"
  ON reports FOR SELECT USING (auth.uid() = user_id);

-- ── Agents（合作房仲）────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT,
  area_coverage   TEXT[],               -- 対応エリア
  languages       TEXT[],               -- 対応言語
  commission_rate FLOAT,                -- 紹介料率
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Leads（房仲導流 CRM）──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id),
  property_id UUID REFERENCES properties(id),
  agent_id    UUID REFERENCES agents(id),
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  message     TEXT,
  locale      TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RPC: ポイント原子的扣除 ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deduct_points(
  p_user_id   UUID,
  p_points    INTEGER,
  p_feature   TEXT,
  p_property_id UUID DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 残高チェック
  UPDATE point_accounts
  SET
    balance    = balance - p_points,
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND balance >= p_points;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_points';
  END IF;

  -- トランザクション記録
  INSERT INTO point_transactions (user_id, delta, feature, property_id)
  VALUES (p_user_id, -p_points, p_feature, p_property_id);
END;
$$;

-- ── RPC: ポイント加算 ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_points(
  p_user_id UUID,
  p_points  INTEGER,
  p_plan_id TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO point_accounts (user_id, balance, lifetime_purchased)
  VALUES (p_user_id, p_points, p_points)
  ON CONFLICT (user_id) DO UPDATE
  SET
    balance            = point_accounts.balance + p_points,
    lifetime_purchased = point_accounts.lifetime_purchased + p_points,
    updated_at         = NOW();

  INSERT INTO point_transactions (user_id, delta, plan_id)
  VALUES (p_user_id, p_points, p_plan_id);
END;
$$;

-- ── Trigger: 新規ユーザー登録時に point_account を初期化 ─────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT DO NOTHING;

  INSERT INTO point_accounts (user_id, balance)
  VALUES (NEW.id, 0)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
