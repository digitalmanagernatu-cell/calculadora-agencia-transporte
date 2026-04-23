const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tariff_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agency_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('nacional', 'internacional', 'ambas')),
      uploaded_at TEXT DEFAULT (datetime('now')),
      filename TEXT NOT NULL,
      FOREIGN KEY(agency_id) REFERENCES agencies(id)
    );

    CREATE TABLE IF NOT EXISTS tariff_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agency_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('nacional', 'internacional')),
      zone TEXT NOT NULL,
      weight_max_kg REAL NOT NULL,
      price REAL NOT NULL,
      extra_per_kg REAL DEFAULT NULL,
      FOREIGN KEY(agency_id) REFERENCES agencies(id)
    );

    CREATE TABLE IF NOT EXISTS zone_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agency_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('nacional', 'internacional')),
      zone TEXT NOT NULL,
      destination TEXT NOT NULL,
      FOREIGN KEY(agency_id) REFERENCES agencies(id)
    );
  `);
}

module.exports = { db, initSchema };
