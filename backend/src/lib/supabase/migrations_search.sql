-- ============================================================
-- Bukken.io Schema 追加: search_results（永久URL用）
-- migrations.sql の末尾に追記してください
-- ============================================================

-- 検索結果テーブル（bukken.io/report/:id の永久URL）
CREATE TABLE IF NOT EXISTS search_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id),
  user_id     UUID REFERENCES auth.users(id),   -- null = 匿名（永遠免費）
  result_data JSONB NOT NULL,
  -- 公開レベル
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  -- SEO用のメタデータ（キャッシュ）
  property_name TEXT,
  property_address TEXT,
  has_issues  BOOLEAN DEFAULT FALSE,
  issue_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 公開URLのインデックス
CREATE INDEX IF NOT EXISTS search_results_public_idx
  ON search_results(is_public, created_at DESC)
  WHERE is_public = TRUE;

CREATE INDEX IF NOT EXISTS search_results_property_idx
  ON search_results(property_id);

-- RLS: 公開結果は誰でも読める
ALTER TABLE search_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public results are readable by all" ON search_results;
CREATE POLICY "Public results are readable by all"
  ON search_results FOR SELECT
  USING (is_public = TRUE);

DROP POLICY IF EXISTS "Users can read own results" ON search_results;
CREATE POLICY "Users can read own results"
  ON search_results FOR SELECT
  USING (auth.uid() = user_id);

-- 永久URLページ用のビュー（SEOメタデータ）
CREATE OR REPLACE VIEW public_report_summary AS
SELECT
  sr.id,
  sr.property_name,
  sr.property_address,
  sr.has_issues,
  sr.issue_count,
  sr.created_at,
  p.price,
  p.area,
  p.age,
  p.platform
FROM search_results sr
LEFT JOIN properties p ON p.id = sr.property_id
WHERE sr.is_public = TRUE;
