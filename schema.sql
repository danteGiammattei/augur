-- AUGUR player accounts (name + hashed PIN + session token + JSON game state)
CREATE TABLE IF NOT EXISTS players (
  name       TEXT PRIMARY KEY,
  pin_hash   TEXT NOT NULL,
  salt       TEXT NOT NULL,
  token      TEXT NOT NULL,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
