const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'r2r2r.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'America/Denver',
    goal_date TEXT,
    experience_level TEXT NOT NULL DEFAULT 'intermediate'
      CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
    weekly_availability TEXT NOT NULL DEFAULT '{}',
    send_time TEXT NOT NULL DEFAULT '20:00',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS strava_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TEXT NOT NULL,
    last_sync_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strava_activity_id TEXT UNIQUE,
    type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    distance_m REAL NOT NULL DEFAULT 0,
    elevation_gain_m REAL NOT NULL DEFAULT 0,
    moving_time_s INTEGER NOT NULL DEFAULT 0,
    average_heartrate REAL,
    raw_json TEXT
  );

  CREATE TABLE IF NOT EXISTS training_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    model TEXT,
    summary TEXT,
    is_current INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS planned_workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    workout_type TEXT NOT NULL,
    description TEXT,
    target_distance_m REAL,
    target_elevation_m REAL,
    target_duration_s INTEGER,
    status TEXT NOT NULL DEFAULT 'planned'
      CHECK (status IN ('planned', 'completed', 'skipped', 'modified')),
    completed_activity_id INTEGER REFERENCES activities(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    body TEXT NOT NULL,
    twilio_sid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS constraints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('injury', 'fatigue', 'travel', 'manual_edit', 'other')),
    description TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    source TEXT NOT NULL DEFAULT 'sms' CHECK (source IN ('sms', 'web', 'system')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, start_date);
  CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON planned_workouts(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
`);

// Lightweight migrations for columns added after initial release
for (const ddl of [
  `ALTER TABLE users ADD COLUMN last_nightly_sent TEXT`,
  `ALTER TABLE users ADD COLUMN last_weekly_sent TEXT`,
]) {
  try {
    db.exec(ddl);
  } catch (err) {
    if (!/duplicate column/.test(err.message)) throw err;
  }
}

module.exports = db;
