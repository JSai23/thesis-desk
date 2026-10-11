-- Briefings (DEC-091): an email built from one or more reports, on its own schedule.
CREATE TABLE briefings (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  report_ids_json TEXT NOT NULL,             -- ordered report ids
  schedule_json TEXT NOT NULL,               -- {"kind":"daily|weekdays|weekly|none","at":"07:30","weekday":1}
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE briefing_runs (
  id TEXT PRIMARY KEY, briefing_id TEXT NOT NULL REFERENCES briefings(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','schedule','catchup')),
  scheduled_for INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  late INTEGER NOT NULL DEFAULT 0,
  report_run_ids_json TEXT NOT NULL DEFAULT '[]',
  markdown TEXT, html TEXT,
  delivered_email_at INTEGER, delivery_error TEXT, error TEXT
);
CREATE INDEX ix_briefing_runs ON briefing_runs(briefing_id, started_at);
-- schedules gains the 'briefing' kind (SQLite can't alter a CHECK: rebuild)
CREATE TABLE schedules_v2 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source_poll','report','maintenance','briefing')),
  target_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  next_run_at INTEGER NOT NULL, last_run_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, target_id)
);
INSERT INTO schedules_v2 SELECT id, kind, target_id, spec_json, next_run_at, last_run_at, enabled FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_v2 RENAME TO schedules;
