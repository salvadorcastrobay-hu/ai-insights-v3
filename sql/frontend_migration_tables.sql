CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  filter_prefs JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_dashboards_owner ON custom_dashboards(owner);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_self ON user_preferences;
CREATE POLICY user_preferences_self
ON user_preferences
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS custom_dashboards_owner ON custom_dashboards;
CREATE POLICY custom_dashboards_owner
ON custom_dashboards
FOR ALL
USING (owner = auth.email())
WITH CHECK (owner = auth.email());

DROP POLICY IF EXISTS custom_dashboards_shared ON custom_dashboards;
CREATE POLICY custom_dashboards_shared
ON custom_dashboards
FOR SELECT
USING (is_shared = true);
