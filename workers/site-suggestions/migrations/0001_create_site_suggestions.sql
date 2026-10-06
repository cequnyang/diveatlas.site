CREATE TABLE site_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  site_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  normalized_region TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  submission_count INTEGER NOT NULL DEFAULT 1,
  first_submitted_at TEXT NOT NULL,
  last_submitted_at TEXT NOT NULL,
  UNIQUE (normalized_name, normalized_region)
) STRICT;

CREATE INDEX site_suggestions_review_queue
  ON site_suggestions (status, first_submitted_at);
