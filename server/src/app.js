const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getDb } = require('./db/connection');
const { ensureSchema } = require('./db/schema');
const { runMigrations } = require('./db/migrations');
const { ensureSeed } = require('./db/seed');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const backupService = require('./services/backup');

// Before an upgraded build touches the schema, take a full snapshot of the
// school's existing database. Installing a new version never deletes data
// (it lives in %APPDATA%, outside the program folder), and migrations are
// additive-only — this is the extra safety net if anything goes wrong.
function backupBeforeUpgrade(db) {
  let lastVersion = null;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app.last_version'").get();
    lastVersion = row ? row.value : null;
  } catch {
    return; // brand-new database: nothing to protect yet
  }
  if (lastVersion === config.appVersion) return;
  try {
    const hasData = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
    if (hasData) {
      const backup = backupService.createBackup(`pre-update-${lastVersion || 'old'}-to-${config.appVersion}`);
      console.log(`Pre-update backup saved: ${backup.fileName}`);
    }
  } catch (err) {
    console.error('Pre-update backup failed (continuing):', err.message);
  }
}

function recordVersion(db) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app.last_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(config.appVersion);
}

function createApp() {
  const db = getDb();
  backupBeforeUpgrade(db);
  ensureSchema(db);
  runMigrations(db);
  ensureSeed(db);
  recordVersion(db);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // Also used by other PCs (client mode) and the LAN discovery probe to confirm
  // they've found a CHAND server, so keep the `app` marker stable.
  app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'chand-sms', version: config.appVersion, time: new Date().toISOString() }));
  app.use('/api', routes);
  app.use('/uploads', express.static(config.uploadsDir));

  if (fs.existsSync(config.clientDist)) {
    // index.html must always be revalidated so phones / other PCs pick up a new
    // build right after an update (hashed JS/CSS assets can cache normally).
    app.use(express.static(config.clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      }
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
