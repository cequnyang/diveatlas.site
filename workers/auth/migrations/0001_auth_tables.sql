CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  picture_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions (expires_at);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON auth_sessions (user_id);
