-- Daily Log — PostgreSQL schema (Neon)
--
-- Run this once in the Neon SQL Editor (or `npm run db:schema` from /backend).
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email       TEXT NOT NULL CHECK (email = lower(email) AND email ~ '^\S+@\S+\.\S+$'),
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  -- "Remove" is a soft delete so past EODs and attendance are kept.
  removed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live account per email; a removed person's email can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_live_key
  ON employees (email) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Projects and episodes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_key ON projects (lower(name));

CREATE TABLE IF NOT EXISTS episodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 0),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  UNIQUE (project_id, position),
  UNIQUE (project_id, name)
);

-- ---------------------------------------------------------------------------
-- End-of-day updates
--   eods            one per employee per day
--   eod_entries     "Scene entry" cards
--   eod_lines       saved lines inside a scene entry
--   eod_line_items  output chips and their counts inside a line
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees (id),
  work_date     DATE NOT NULL,
  remarks       TEXT NOT NULL DEFAULT '',
  plan          TEXT NOT NULL DEFAULT '',
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS eods_work_date_idx ON eods (work_date);

CREATE TABLE IF NOT EXISTS eod_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eod_id      UUID NOT NULL REFERENCES eods (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  project_id  UUID NOT NULL REFERENCES projects (id),
  episode_id  UUID NOT NULL REFERENCES episodes (id),
  scene       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL CHECK (kind IN ('Fresh', 'Revision', 'Test', 'Trailer', 'Training')),
  status      TEXT NOT NULL CHECK (status IN ('In progress', 'Sent for approval', 'On hold', 'Done')),
  UNIQUE (eod_id, position)
);

CREATE INDEX IF NOT EXISTS eod_entries_project_idx ON eod_entries (project_id, episode_id);

CREATE TABLE IF NOT EXISTS eod_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID NOT NULL REFERENCES eod_entries (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  work_type    TEXT NOT NULL CHECK (work_type IN ('image', 'clip')),
  description  TEXT NOT NULL CHECK (length(trim(description)) > 0),
  UNIQUE (entry_id, position)
);

CREATE TABLE IF NOT EXISTS eod_line_items (
  line_id     UUID NOT NULL REFERENCES eod_lines (id) ON DELETE CASCADE,
  output_key  TEXT NOT NULL CHECK (output_key IN (
                'charsheet', 'location', 'storyboard', 'keyframe',
                'clip', 'lipsync', 'extend', 'upscale')),
  count       INTEGER NOT NULL CHECK (count BETWEEN 1 AND 999),
  PRIMARY KEY (line_id, output_key)
);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- Per-person, per-day status set by the manager. A weekday without a row
-- counts as an expected working day.
CREATE TABLE IF NOT EXISTS attendance (
  employee_id  UUID NOT NULL REFERENCES employees (id),
  work_date    DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('present', 'absent', 'half', 'wfh', 'leave', 'holiday')),
  check_in     TIME,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_work_date_idx ON attendance (work_date);

-- Studio-wide holidays ("Mark holiday for everyone").
CREATE TABLE IF NOT EXISTS holidays (
  holiday_date  DATE PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- EOD reminders sent from the dashboard
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reminders (
  employee_id  UUID NOT NULL REFERENCES employees (id),
  work_date    DATE NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by      UUID REFERENCES employees (id),
  PRIMARY KEY (employee_id, work_date)
);

-- ---------------------------------------------------------------------------
-- Manager account
--
-- Sign-in is by email, so at least one manager must exist. Change the email
-- (and name) below to your manager's real address before running.
-- ---------------------------------------------------------------------------

INSERT INTO employees (name, email, role)
SELECT 'Manager', lower('Suraj@faiblemedia.com'), 'manager'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE role = 'manager' AND removed_at IS NULL);
