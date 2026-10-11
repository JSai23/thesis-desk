-- What the user says about an object (Backlog "Your description of anything comes first", DEC-099): kept apart from what
-- the agent maintains, never overwritten by sources; the lookup, reading and matching use it as context, not evidence.
CREATE TABLE object_details (
  object_type TEXT NOT NULL CHECK (object_type IN ('company','firm','person','thesis','source')),
  object_id TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',             -- what it does / who they are / what you want from it
  website TEXT,                               -- company / firm: the user's word on its site
  other_names_json TEXT NOT NULL DEFAULT '[]',
  fields_json TEXT NOT NULL DEFAULT '{}',     -- kind-specific: sector, stage, role, org, howKnown, proof …
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (object_type, object_id)
);
