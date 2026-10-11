
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rss','web','hn_api','email','manual','search')),
  locator TEXT NOT NULL,
  canonical_locator TEXT NOT NULL,
  site_domain TEXT,
  type_label TEXT NOT NULL,                  -- UI chip: 'RSS feed','Website','Company blog','VC blog','Publication','Newsletter','Hacker News'
  trust TEXT NOT NULL DEFAULT 'editorial' CHECK (trust IN ('primary','editorial','community')),
  mode TEXT NOT NULL DEFAULT 'relevant' CHECK (mode IN ('all','relevant','custom')),
  instruction TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,                 -- SourceConfig (§1B.7)
  freq TEXT NOT NULL DEFAULT 'daily' CHECK (freq IN ('realtime','hourly','daily','weekly')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  enabled INTEGER NOT NULL DEFAULT 1,
  muted_until INTEGER,
  auth_strategy TEXT NOT NULL DEFAULT 'none' CHECK (auth_strategy IN ('none','app_browser_session','email_ingress')),
  auth_state TEXT NOT NULL DEFAULT 'not_required'
    CHECK (auth_state IN ('not_required','unknown','login_required','authenticating','authenticated','expired','blocked','unsupported')),
  auth_profile_json TEXT,                    -- AuthProfile (§1B.8.5)
  cursor_json TEXT,
  health TEXT NOT NULL DEFAULT 'ok' CHECK (health IN ('ok','failing','blocked')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT, last_error_message TEXT,
  last_attempt_at INTEGER, last_success_at INTEGER,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user','starter_pack','suggestion','system')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_sources_locator ON sources(canonical_locator) WHERE deleted_at IS NULL;
-- A single system row id='src_manual', kind='manual', origin='system' owns Read-once documents; hidden from source lists.

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('web','email','text')),
  canonical_url TEXT, url TEXT, email_message_id TEXT,
  title TEXT NOT NULL, author TEXT, site_name TEXT,
  published_at INTEGER,
  first_fetched_at INTEGER NOT NULL, last_fetched_at INTEGER NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,                -- sha256 of normalized text (current version)
  text TEXT NOT NULL,                        -- normalized plain text, paragraphs separated by "\n\n"
  text_chars INTEGER NOT NULL,
  access TEXT NOT NULL DEFAULT 'full' CHECK (access IN ('full','partial')),
  status TEXT NOT NULL CHECK (status IN ('pending_capture','fetched','processing','processed','triaged_out','failed','duplicate')),  -- pending_capture: user-sent URL awaiting sign-in/retry; text may be '' (See DEC-073)
  duplicate_of_id TEXT REFERENCES documents(id),
  summary TEXT,                              -- AI interpretation
  processing_error TEXT,
  ai_generation INTEGER NOT NULL DEFAULT 0,  -- incremented on reset/reprocess
  metadata_json TEXT NOT NULL DEFAULT '{}',  -- hn score/comments, email from/list-id, listing position, lang
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_documents_url ON documents(canonical_url) WHERE canonical_url IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_documents_msgid ON documents(email_message_id) WHERE email_message_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_documents_hash ON documents(content_hash);
CREATE INDEX ix_documents_pub ON documents(published_at);
CREATE INDEX ix_documents_status ON documents(status);

CREATE TABLE document_versions (
  document_id TEXT NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  raw_path TEXT,                             -- relative to data dir
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (document_id, version)
);

CREATE TABLE document_sources (
  document_id TEXT NOT NULL REFERENCES documents(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  item_key TEXT,                             -- feed guid / HN id / IMAP uid / listing url
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (document_id, source_id)
);
CREATE INDEX ix_docsrc_source ON document_sources(source_id);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  document_version INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('ai_extraction','user_highlight')),
  kind TEXT NOT NULL CHECK (kind IN ('funding','investment','fund_raise','product_launch','partnership','customer_adoption',
                                     'pricing','executive_change','acquisition','expansion','metric','opinion','other')),
  assertion TEXT NOT NULL CHECK (assertion IN ('fact','attributed_opinion')),
  claim TEXT NOT NULL,                       -- one normalized sentence
  quote TEXT NOT NULL,                       -- verbatim from document version text
  quote_start INTEGER NOT NULL, quote_end INTEGER NOT NULL,
  attributed_to TEXT,                        -- speaker/org for opinions
  event_date TEXT,                           -- ISO date if stated
  payload_json TEXT NOT NULL DEFAULT '{}',   -- kind-specific (§1B.9.6)
  fingerprint TEXT,                          -- novelty key
  is_novel INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL,
  kept INTEGER NOT NULL DEFAULT 0,           -- user "Keep"/highlight
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','orphaned')),
  ai_generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_evidence_doc ON evidence(document_id, status);
CREATE INDEX ix_evidence_fp ON evidence(fingerprint);
CREATE INDEX ix_evidence_kind ON evidence(kind, created_at);

CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, domain TEXT,
  followed INTEGER NOT NULL DEFAULT 0, followed_at INTEGER,
  merged_into_id TEXT REFERENCES companies(id), last_viewed_at INTEGER,
  created_origin TEXT NOT NULL CHECK (created_origin IN ('source_fact','user')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_companies_domain ON companies(domain) WHERE domain IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL;
CREATE INDEX ix_companies_name ON companies(normalized_name);

CREATE TABLE firms (   -- venture firms
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, domain TEXT,
  followed INTEGER NOT NULL DEFAULT 0, followed_at INTEGER,
  merged_into_id TEXT REFERENCES firms(id), last_viewed_at INTEGER,
  created_origin TEXT NOT NULL CHECK (created_origin IN ('source_fact','user')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_firms_domain ON firms(domain) WHERE domain IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL;
CREATE INDEX ix_firms_name ON firms(normalized_name);

CREATE TABLE people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  followed INTEGER NOT NULL DEFAULT 0, followed_at INTEGER, merged_into_id TEXT REFERENCES people(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX ix_people_name ON people(normalized_name);

CREATE TABLE theses (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES theses(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', current_view TEXT NOT NULL DEFAULT '',
  conviction INTEGER NOT NULL DEFAULT 2 CHECK (conviction BETWEEN 1 AND 5),
  watching INTEGER NOT NULL DEFAULT 1, archived_at INTEGER, merged_into_id TEXT REFERENCES theses(id),
  sort_order INTEGER NOT NULL DEFAULT 0, last_viewed_at INTEGER,
  created_origin TEXT NOT NULL DEFAULT 'user' CHECK (created_origin IN ('user','accepted_suggestion')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_theses_parent ON theses(parent_id);

CREATE TABLE aliases (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company','firm','person')),
  entity_id TEXT NOT NULL, alias TEXT NOT NULL, alias_normalized TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('source_fact','user','merge')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, alias_normalized)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'observation' CHECK (kind IN ('observation','question','counterpoint','correction')),
  text TEXT NOT NULL,
  anchor_type TEXT NOT NULL DEFAULT 'none' CHECK (anchor_type IN ('thesis','company','firm','none')),
  anchor_id TEXT,
  document_id TEXT REFERENCES documents(id),  -- written while reading this document
  quote TEXT,
  kind_origin TEXT NOT NULL DEFAULT 'ai' CHECK (kind_origin IN ('user','ai')),  -- 'user' once the user picked the type; AI never changes it then
  ai_state TEXT NOT NULL DEFAULT 'pending' CHECK (ai_state IN ('pending','organized','failed','skipped')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX ix_notes_anchor ON notes(anchor_type, anchor_id);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL CHECK (from_type IN ('document','evidence','company','firm','person','thesis','note','source')),
  from_id TEXT NOT NULL,
  rel TEXT NOT NULL CHECK (rel IN ('mentions','about','invested_in','works_at','partner_at','founded','relates_to','covers')),
  to_type TEXT NOT NULL CHECK (to_type IN ('company','firm','person','thesis')),
  to_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('source_fact','ai_inference','user')),
  status TEXT NOT NULL CHECK (status IN ('accepted','suggested','rejected','inactive')),  -- inactive: source_fact with no active support
  stance TEXT CHECK (stance IN ('support','contra','neutral')),
  confidence REAL,
  explanation TEXT,                          -- AI rationale (interpretation)
  payload_json TEXT NOT NULL DEFAULT '{}',   -- derived display summary (e.g. latest {"role":"lead"}, {"title":"CEO"}); recomputed from active support; per-fact detail lives in evidence.payload_json
  ai_generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (from_type, from_id, rel, to_type, to_id)
);
CREATE INDEX ix_rel_to ON relationships(to_type, to_id, rel, status);
CREATE INDEX ix_rel_from ON relationships(from_type, from_id, rel, status);

CREATE TABLE relationship_evidence (   -- many supporting evidence rows per relationship (See DEC-039)
  relationship_id TEXT NOT NULL REFERENCES relationships(id),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (relationship_id, evidence_id)
);
CREATE INDEX ix_relev_evidence ON relationship_evidence(evidence_id);

CREATE TABLE suggestions (   -- non-relationship proposals only (DEC-024)
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('new_thesis','entity_merge','field_update','source')),
  target_type TEXT, target_id TEXT,
  payload_json TEXT NOT NULL, explanation TEXT NOT NULL, confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','expired')),
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, resolved_at INTEGER
);

CREATE TABLE field_defs (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (object_type IN ('company','firm','thesis')),
  key TEXT NOT NULL, label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('text','number','money','date','enum','url')),
  enum_values_json TEXT, builtin INTEGER NOT NULL DEFAULT 0, extraction_instruction TEXT,
  created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_field_defs ON field_defs(object_type, key) WHERE deleted_at IS NULL;
-- Seeded builtins: company.stage(enum), company.hq, company.founded, company.tagline, company.website(url);
-- firm.hq, firm.tagline, firm.website(url).
-- stage enum: Pre-seed, Seed, Series A..Series H, Late stage, Acquired, Public, Unknown.

CREATE TABLE field_values (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL, object_id TEXT NOT NULL, field_key TEXT NOT NULL,
  value_json TEXT NOT NULL, display TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('source_fact','ai_inference','user')),
  evidence_id TEXT REFERENCES evidence(id),
  status TEXT NOT NULL CHECK (status IN ('current','superseded','proposed','rejected')),
  created_at INTEGER NOT NULL, created_by_run_id TEXT
);
CREATE UNIQUE INDEX ux_field_current ON field_values(object_type, object_id, field_key) WHERE status = 'current';
CREATE INDEX ix_field_values ON field_values(object_type, object_id, field_key, status);

CREATE TABLE feed_items (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE REFERENCES documents(id),
  primary_source_id TEXT NOT NULL REFERENCES sources(id),
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,                     -- AI interpretation (2 sentences)
  why_it_matters TEXT NOT NULL DEFAULT '',   -- AI interpretation
  reasons_json TEXT NOT NULL,                -- deterministic reasons [{type,label,ref}]
  group_key TEXT NOT NULL CHECK (group_key IN ('important','companies','theses','sources','firms')),
  score REAL NOT NULL, importance REAL NOT NULL, novelty REAL NOT NULL,
  primary_thesis_id TEXT REFERENCES theses(id), primary_stance TEXT CHECK (primary_stance IN ('support','contra','neutral')),
  needs_review INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT CHECK (hidden_reason IN ('muted','source_removed','topic_muted')),
  surfaced_at INTEGER NOT NULL,
  read_at INTEGER, saved_at INTEGER, dismissed_at INTEGER, dismiss_reason TEXT,
  feedback TEXT CHECK (feedback IN ('more','less')),
  alert_rule_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_feed_surfaced ON feed_items(surfaced_at);
CREATE INDEX ix_feed_state ON feed_items(dismissed_at, read_at, saved_at);

CREATE TABLE view_definitions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('type','object','saved_feed')),
  object_type TEXT NOT NULL CHECK (object_type IN ('company','firm','thesis','feed')),
  object_id TEXT,                            -- scope='object'
  name TEXT,                                 -- scope='saved_feed'
  definition_json TEXT NOT NULL, instruction TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_view_scope ON view_definitions(scope, object_type, IFNULL(object_id,'')) WHERE scope <> 'saved_feed';

CREATE TABLE reports (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,     -- draft name = first 60 chars of prompt_text
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','failed')),
  prompt_text TEXT,                            -- the user's original request (never discarded)
  pending_refinement TEXT,                     -- refinement text awaiting COMPILE_REPORT{mode:'refine'}
  last_error TEXT,
  definition_json TEXT,                        -- ReportDefinition (§1B.17); NULL while draft/failed-before-first-compile
  enabled INTEGER NOT NULL DEFAULT 1, template_key TEXT,
  last_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE report_runs (
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','schedule','catchup','preview')),
  scheduled_for INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  late INTEGER NOT NULL DEFAULT 0,
  content_json TEXT,                         -- snapshot: sections, rows, citations
  markdown TEXT, html TEXT,
  delivered_email_at INTEGER, delivery_error TEXT, error TEXT
);
CREATE INDEX ix_runs_report ON report_runs(report_id, started_at);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, name TEXT NOT NULL,   -- text = user's request (never discarded)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','compiled','active','failed')),
  rule_json TEXT,                            -- AlertRule (§1B.18); NULL while draft
  summary TEXT, backtest_count INTEGER, last_error TEXT,
  channels_json TEXT NOT NULL,               -- ["in_app"] | ["in_app","email"]
  enabled INTEGER NOT NULL DEFAULT 1, cooldown_minutes INTEGER NOT NULL DEFAULT 360,
  anchor_type TEXT, anchor_id TEXT, last_triggered_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY, alert_rule_id TEXT NOT NULL REFERENCES alert_rules(id),
  evidence_id TEXT REFERENCES evidence(id), document_id TEXT REFERENCES documents(id),   -- NULL after purge; title/body keep the snapshot
  title TEXT NOT NULL, body TEXT NOT NULL,
  channels_json TEXT NOT NULL,
  suppressed_reason TEXT CHECK (suppressed_reason IN ('cooldown','daily_cap','disabled')),
  delivered_in_app_at INTEGER, delivered_email_at INTEGER, delivery_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (alert_rule_id, evidence_id)
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source_poll','report','maintenance')),
  target_id TEXT NOT NULL,                   -- source id | report id | maintenance task key
  spec_json TEXT NOT NULL,                   -- {"everyMinutes":60} | {"at":"07:30","days":[1,2,3,4,5]}
  next_run_at INTEGER NOT NULL, last_run_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, target_id)
);
CREATE INDEX ix_sched_due ON schedules(enabled, next_run_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 5,       -- 1 highest
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
  run_after INTEGER NOT NULL, lease_expires_at INTEGER,
  idempotency_key TEXT,
  error_code TEXT, error_message TEXT, result_json TEXT,
  parent_job_id TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE UNIQUE INDEX ux_jobs_idem ON jobs(idempotency_key) WHERE status IN ('queued','running');
CREATE INDEX ix_jobs_ready ON jobs(status, priority, run_after);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY, task TEXT NOT NULL, prompt_version TEXT NOT NULL, model TEXT NOT NULL,
  job_id TEXT, input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','invalid','failed','refused')),
  attempts INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  latency_ms INTEGER, error TEXT, output_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_agent_runs_task ON agent_runs(task, created_at);

CREATE TABLE history (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL,                      -- e.g. thesis.view_revised, thesis.conviction, thesis.child_created, evidence.accepted,
                                             -- view.changed, report.changed, alert.changed, field.corrected, merge, source.config, source.reset
  before_json TEXT, after_json TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('user','ai','system')),
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_history_entity ON history(entity_type, entity_id, created_at);

-- Full-text search (external content, maintained by triggers on insert/update/delete)
CREATE VIRTUAL TABLE fts_documents USING fts5(title, text, content='documents', content_rowid='rowid', tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_evidence  USING fts5(claim, quote, content='evidence', content_rowid='rowid', tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_notes     USING fts5(text, content='notes', content_rowid='rowid', tokenize='porter unicode61');

-- FTS external-content maintenance triggers (B-DATA-004)
CREATE TRIGGER trg_documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO fts_documents(rowid, title, text) VALUES (new.rowid, new.title, new.text);
END;
CREATE TRIGGER trg_documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO fts_documents(fts_documents, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
END;
CREATE TRIGGER trg_documents_au AFTER UPDATE OF title, text ON documents BEGIN
  INSERT INTO fts_documents(fts_documents, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
  INSERT INTO fts_documents(rowid, title, text) VALUES (new.rowid, new.title, new.text);
END;
CREATE TRIGGER trg_evidence_ai AFTER INSERT ON evidence BEGIN
  INSERT INTO fts_evidence(rowid, claim, quote) VALUES (new.rowid, new.claim, new.quote);
END;
CREATE TRIGGER trg_evidence_ad AFTER DELETE ON evidence BEGIN
  INSERT INTO fts_evidence(fts_evidence, rowid, claim, quote) VALUES ('delete', old.rowid, old.claim, old.quote);
END;
CREATE TRIGGER trg_evidence_au AFTER UPDATE OF claim, quote ON evidence BEGIN
  INSERT INTO fts_evidence(fts_evidence, rowid, claim, quote) VALUES ('delete', old.rowid, old.claim, old.quote);
  INSERT INTO fts_evidence(rowid, claim, quote) VALUES (new.rowid, new.claim, new.quote);
END;
CREATE TRIGGER trg_notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO fts_notes(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER trg_notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO fts_notes(fts_notes, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER trg_notes_au AFTER UPDATE OF text ON notes BEGIN
  INSERT INTO fts_notes(fts_notes, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO fts_notes(rowid, text) VALUES (new.rowid, new.text);
END;
