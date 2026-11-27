const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  return db;
}

// Used by backup restore to swap the database file safely. The next getDb()
// call reopens it.
function closeDb() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  db.close();
  db = null;
}

module.exports = { getDb, closeDb };
