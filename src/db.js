'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  start_date    TEXT    NOT NULL,
  weekend_days  TEXT    NOT NULL DEFAULT '0,6',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL,
  name        TEXT    NOT NULL DEFAULT '',
  UNIQUE (project_id, date)
);

CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code        TEXT    NOT NULL DEFAULT '',
  name        TEXT    NOT NULL,
  duration    INTEGER NOT NULL CHECK (duration > 0),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dependencies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id     INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  predecessor_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL DEFAULT 'FS' CHECK (type IN ('FS','SS')),
  delay           INTEGER NOT NULL DEFAULT 0 CHECK (delay >= 0),
  UNIQUE (activity_id, predecessor_id),
  CHECK (activity_id <> predecessor_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL DEFAULT '',
  phone       TEXT    NOT NULL DEFAULT '',
  position    TEXT    NOT NULL DEFAULT '',
  daily_rate  REAL    NOT NULL DEFAULT 0 CHECK (daily_rate >= 0)
);

CREATE TABLE IF NOT EXISTS assignments (
  activity_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  resource_id  INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_holidays_project ON holidays(project_id);
CREATE INDEX IF NOT EXISTS idx_resources_project ON resources(project_id);
CREATE INDEX IF NOT EXISTS idx_deps_activity ON dependencies(activity_id);
`;

const DEFAULT_DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'mini-gantt.db');

/** Buka (dan buat bila perlu) koneksi SQLite + terapkan skema. */
function openDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Ambil semua baris sebagai array object biasa. */
function all(db, sql, params = []) {
  return db.prepare(sql).all(...params).map((row) => ({ ...row }));
}

/** Ambil satu baris (atau null). */
function get(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
}

/** Jalankan statement tulis; kembalikan { changes, lastInsertRowid } sebagai Number. */
function run(db, sql, params = []) {
  const res = db.prepare(sql).run(...params);
  return {
    changes: Number(res.changes),
    lastInsertRowid: Number(res.lastInsertRowid),
  };
}

module.exports = { openDb, all, get, run, DEFAULT_DB_PATH, SCHEMA };
