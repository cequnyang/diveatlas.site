CREATE TABLE site_photo_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL,
  site_name TEXT NOT NULL,
  submitter_user_id TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  credit_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  sha256 TEXT NOT NULL,
  attested_real_location INTEGER NOT NULL CHECK (attested_real_location = 1),
  attested_not_ai_generated INTEGER NOT NULL CHECK (attested_not_ai_generated = 1),
  attested_rights INTEGER NOT NULL CHECK (attested_rights = 1),
  license_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer_note TEXT
) STRICT;

CREATE INDEX site_photo_submissions_review_queue
  ON site_photo_submissions (status, submitted_at);

CREATE INDEX site_photo_submissions_submitter_limit
  ON site_photo_submissions (submitter_user_id, submitted_at);

CREATE INDEX site_photo_submissions_site_pending
  ON site_photo_submissions (site_id, submitter_user_id, status);
