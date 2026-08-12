-- ============================================
-- HARDCORE Predictions - STRICT MODE Schema
-- ============================================

-- Drop old objects first (clean slate)
DROP TABLE IF EXISTS prediction_results CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS fixtures CASCADE;
DROP TABLE IF EXISTS team_stats CASCADE;

-- ============================================
-- TEAM STATS (built from match results)
-- ============================================
CREATE TABLE team_stats (
  id SERIAL PRIMARY KEY,
  team_id INTEGER,
  team_name TEXT NOT NULL,
  competition TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  home_games INTEGER DEFAULT 0,
  home_wins INTEGER DEFAULT 0,
  home_draws INTEGER DEFAULT 0,
  home_losses INTEGER DEFAULT 0,
  home_goals_for INTEGER DEFAULT 0,
  home_goals_against INTEGER DEFAULT 0,
  away_games INTEGER DEFAULT 0,
  away_wins INTEGER DEFAULT 0,
  away_draws INTEGER DEFAULT 0,
  away_losses INTEGER DEFAULT 0,
  away_goals_for INTEGER DEFAULT 0,
  away_goals_against INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  draw_rate NUMERIC DEFAULT 0,
  loss_rate NUMERIC DEFAULT 0,
  avg_goals_for NUMERIC DEFAULT 0,
  avg_goals_against NUMERIC DEFAULT 0,
  home_avg_goals_for NUMERIC DEFAULT 0,
  home_avg_goals_against NUMERIC DEFAULT 0,
  away_avg_goals_for NUMERIC DEFAULT 0,
  away_avg_goals_against NUMERIC DEFAULT 0,
  form_string TEXT DEFAULT '',
  form_points INTEGER DEFAULT 0,
  data_quality NUMERIC DEFAULT 0,
  crest TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, competition)
);

-- ============================================
-- FIXTURES
-- ============================================
CREATE TABLE fixtures (
  id SERIAL PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  league TEXT NOT NULL,
  status TEXT DEFAULT 'NS',
  home_goals INTEGER,
  away_goals INTEGER,
  home_team_id INTEGER,
  away_team_id INTEGER,
  competition_code TEXT DEFAULT 'PL',
  matchday INTEGER,
  season TEXT DEFAULT '2025',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(home_team, away_team, match_date)
);

-- ============================================
-- PREDICTIONS
-- ============================================
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id) ON DELETE CASCADE,
  best_market TEXT NOT NULL,
  best_market_code TEXT,
  best_probability NUMERIC NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  all_probabilities JSONB,
  reasoning TEXT,
  data_quality INTEGER DEFAULT 0,
  strict_mode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PREDICTION RESULTS (for streak tracking)
-- ============================================
CREATE TABLE prediction_results (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER REFERENCES predictions(id) ON DELETE CASCADE,
  fixture_id INTEGER REFERENCES fixtures(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('WIN', 'LOSS', 'PENDING')),
  home_goals INTEGER,
  away_goals INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_fixtures_date ON fixtures(match_date);
CREATE INDEX idx_fixtures_status ON fixtures(status);
CREATE INDEX idx_fixtures_competition ON fixtures(competition_code);
CREATE INDEX idx_team_stats_competition ON team_stats(competition);
CREATE INDEX idx_predictions_fixture ON predictions(fixture_id);
CREATE INDEX idx_predictions_confidence ON predictions(confidence);
CREATE INDEX idx_results_fixture ON prediction_results(fixture_id);
CREATE INDEX idx_results_date ON prediction_results(created_at);

-- ============================================
-- AUTO-UPDATE TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fixtures_updated_at
  BEFORE UPDATE ON fixtures
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER team_stats_updated_at
  BEFORE UPDATE ON team_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- DONE
-- ============================================
SELECT 'Schema created successfully! STRICT MODE ready.' AS status;
