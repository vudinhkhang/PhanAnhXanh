CREATE TABLE IF NOT EXISTS users (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','staff','citizen')), active boolean NOT NULL DEFAULT true
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS areas text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
 id text PRIMARY KEY, owner bigint REFERENCES users(id), title text NOT NULL, description text NOT NULL,
 location text NOT NULL, public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','resolved')),
 ai_group text, ai_state text NOT NULL DEFAULT 'pending', ai_attempts integer NOT NULL DEFAULT 0,
 ai_next timestamptz NOT NULL DEFAULT now(), urgent boolean NOT NULL DEFAULT false,
 confirmed_group text, priority text NOT NULL DEFAULT 'normal', assignee bigint REFERENCES users(id),
 sample_photo text
);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS pin_lat double precision CHECK (pin_lat BETWEEN -90 AND 90);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS pin_lng double precision CHECK (pin_lng BETWEEN -180 AND 180);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ward text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_consent boolean NOT NULL DEFAULT false;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_source text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS intake_state text CHECK (intake_state IN ('pending','review','passed','rejected'));
ALTER TABLE reports ADD COLUMN IF NOT EXISTS intake_reason text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS intake_note text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS intake_photos integer[] NOT NULL DEFAULT '{}';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS duplicate_of text REFERENCES reports(id);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS guest_receipt text;
CREATE TABLE IF NOT EXISTS submission_quota (
 source text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS submission_quota_expiry ON submission_quota(expires_at);
UPDATE reports SET intake_state=CASE WHEN status='rejected' THEN 'rejected' ELSE 'passed' END WHERE intake_state IS NULL;
ALTER TABLE reports ALTER COLUMN intake_state SET DEFAULT 'passed';
ALTER TABLE reports ALTER COLUMN intake_state SET NOT NULL;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE reports ADD CONSTRAINT reports_status_check CHECK (status IN ('received','processing','resolved','rejected','cancelled'));
CREATE TABLE IF NOT EXISTS photos (
 report_id text NOT NULL REFERENCES reports(id), position integer NOT NULL CHECK (position BETWEEN 0 AND 2),
 data bytea NOT NULL, PRIMARY KEY (report_id,position)
);
CREATE TABLE IF NOT EXISTS history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, report_id text REFERENCES reports(id) NOT NULL,
 status text NOT NULL, note text NOT NULL, author bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE history ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS notifications (
 report_id text PRIMARY KEY REFERENCES reports(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS reports_pending ON reports(ai_next) WHERE ai_state='pending';
CREATE INDEX IF NOT EXISTS reports_intake_group ON reports ((COALESCE(confirmed_group,ai_group)))
 WHERE intake_state='passed' AND status IN ('received','processing');
CREATE INDEX IF NOT EXISTS history_report ON history(report_id,id DESC);
CREATE TABLE IF NOT EXISTS local_updates (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL, summary text NOT NULL, ward text, source_url text NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL CHECK (ends_on >= starts_on),
 published boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS news_articles (
 slug text PRIMARY KEY,
 title text NOT NULL, summary text NOT NULL, category text NOT NULL, area text NOT NULL,
 source_name text NOT NULL, source_url text, image text, content jsonb NOT NULL,
 published boolean NOT NULL DEFAULT false,
 published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_articles_publication ON news_articles(published_at DESC) WHERE published;

