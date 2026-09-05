PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS gamble_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grow_id TEXT NOT NULL UNIQUE,
  discord_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  grow_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS cooldowns (
  account_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,key),
  FOREIGN KEY(account_id) REFERENCES gamble_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS game_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  label TEXT NOT NULL,
  wager INTEGER NOT NULL DEFAULT 0,
  delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES gamble_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS cashouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  grow_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  FOREIGN KEY(account_id) REFERENCES gamble_accounts(id) ON DELETE CASCADE
);
