-- Migrate research data from separate research-db into the backend database.
--
-- Prerequisites:
--   1. Backend schema migration "add_research_tables" has been applied
--   2. Research database is accessible (default: localhost:5433, user: research)
--
-- Usage:
--   Option A: Run via dblink (requires dblink extension)
--   Option B: Export from research-db as CSV, then COPY into backend
--
-- ============================================================
-- OPTION A: Via dblink (run against backend database)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS dblink;

-- Tickers
INSERT INTO research_ticker (id, symbol, sec_type, status, source, added_at, last_analyzed)
SELECT id, symbol, sec_type, status, source, added_at, last_analyzed
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, symbol, sec_type, status, source, added_at, last_analyzed FROM ticker'
) AS t(id uuid, symbol varchar, sec_type varchar, status varchar, source varchar, added_at timestamptz, last_analyzed timestamptz)
ON CONFLICT (symbol) DO NOTHING;

-- Data Collections
INSERT INTO data_collection (id, ticker_id, source, collected_at, status, data, skip_reason, expires_at)
SELECT dc.id, dc.ticker_id, dc.source, dc.collected_at, dc.status, dc.data, dc.skip_reason, dc.expires_at
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, ticker_id, source, collected_at, status, data, skip_reason, expires_at FROM data_collection'
) AS dc(id uuid, ticker_id uuid, source varchar, collected_at timestamptz, status varchar, data jsonb, skip_reason text, expires_at timestamptz)
ON CONFLICT (id) DO NOTHING;

-- Analyses
INSERT INTO analysis (id, ticker_id, source, analyzed_at, signal, confidence, summary, details)
SELECT a.id, a.ticker_id, a.source, a.analyzed_at, a.signal, a.confidence, a.summary, a.details
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, ticker_id, source, analyzed_at, signal, confidence, summary, details FROM analysis'
) AS a(id uuid, ticker_id uuid, source varchar, analyzed_at timestamptz, signal varchar, confidence float8, summary text, details jsonb)
ON CONFLICT (id) DO NOTHING;

-- Reports
INSERT INTO research_report (id, ticker_id, created_at, recommendation, confidence, summary, full_report, analysis_ids)
SELECT r.id, r.ticker_id, r.created_at, r.recommendation, r.confidence, r.summary, r.full_report, r.analysis_ids
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, ticker_id, created_at, recommendation, confidence, summary, full_report, analysis_ids FROM report'
) AS r(id uuid, ticker_id uuid, created_at timestamptz, recommendation varchar, confidence float8, summary text, full_report text, analysis_ids uuid[])
ON CONFLICT (id) DO NOTHING;

-- Jobs
INSERT INTO research_job (id, type, symbol, status, progress, result, error, created_at, started_at, completed_at)
SELECT j.id, j.type, j.symbol, j.status, j.progress, j.result, j.error, j.created_at, j.started_at, j.completed_at
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, type, symbol, status, progress, result, error, created_at, started_at, completed_at FROM job'
) AS j(id uuid, type varchar, symbol varchar, status varchar, progress text, result jsonb, error text, created_at timestamptz, started_at timestamptz, completed_at timestamptz)
ON CONFLICT (id) DO NOTHING;

-- Screener Configs
INSERT INTO screener_config (id, name, criteria, schedule, enabled, last_run)
SELECT sc.id, sc.name, sc.criteria, sc.schedule, sc.enabled, sc.last_run
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, name, criteria, schedule, enabled, last_run FROM screener_config'
) AS sc(id uuid, name varchar, criteria jsonb, schedule varchar, enabled boolean, last_run timestamptz)
ON CONFLICT (id) DO NOTHING;

-- Macro Snapshots
INSERT INTO macro_snapshot (id, analyzed_at, regime, confidence, summary, details)
SELECT ms.id, ms.analyzed_at, ms.regime, ms.confidence, ms.summary, ms.details
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, analyzed_at, regime, confidence, summary, details FROM macro_snapshot'
) AS ms(id uuid, analyzed_at timestamptz, regime varchar, confidence float8, summary text, details jsonb)
ON CONFLICT (id) DO NOTHING;

-- Settings (merge research settings into backend settings)
INSERT INTO settings (id, key, value, updated_at)
SELECT s.id, s.key, s.value, s.updated_at
FROM dblink(
  'dbname=research host=localhost port=5433 user=research password=research_dev',
  'SELECT id, key, value, updated_at FROM setting'
) AS s(id uuid, key varchar, value jsonb, updated_at timestamptz)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

-- ============================================================
-- OPTION B: Via CSV export/import
-- ============================================================
-- From research-db:
--   \copy ticker TO '/tmp/research_ticker.csv' WITH CSV HEADER
--   \copy data_collection TO '/tmp/research_data_collection.csv' WITH CSV HEADER
--   \copy analysis TO '/tmp/research_analysis.csv' WITH CSV HEADER
--   \copy report TO '/tmp/research_report.csv' WITH CSV HEADER
--   \copy job TO '/tmp/research_job.csv' WITH CSV HEADER
--   \copy screener_config TO '/tmp/research_screener_config.csv' WITH CSV HEADER
--   \copy macro_snapshot TO '/tmp/research_macro_snapshot.csv' WITH CSV HEADER
--   \copy setting TO '/tmp/research_setting.csv' WITH CSV HEADER
--
-- Into backend db:
--   \copy research_ticker FROM '/tmp/research_ticker.csv' WITH CSV HEADER
--   \copy data_collection FROM '/tmp/research_data_collection.csv' WITH CSV HEADER
--   \copy analysis FROM '/tmp/research_analysis.csv' WITH CSV HEADER
--   \copy research_report FROM '/tmp/research_report.csv' WITH CSV HEADER
--   \copy research_job FROM '/tmp/research_job.csv' WITH CSV HEADER
--   \copy screener_config FROM '/tmp/research_screener_config.csv' WITH CSV HEADER
--   \copy macro_snapshot FROM '/tmp/research_macro_snapshot.csv' WITH CSV HEADER
--   \copy settings FROM '/tmp/research_setting.csv' WITH CSV HEADER
