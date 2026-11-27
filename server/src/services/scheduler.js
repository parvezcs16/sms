// Background jobs, checked every minute on the server PC:
//  - when the date changes: note the new school day (clients reset their
//    daily screens — attendance, check-in — off /api/attendance/server-date);
//  - daily local backup at the set time;
//  - daily Google Drive backup at the set time (if switched on);
//  - automatic monthly fee invoices on the set day of the month.
// Each job remembers its last run in settings, so a restart never repeats it
// and a PC that was switched off catches up the next time it starts.
const { getDb } = require('../db/connection');
const { getSetting, setSetting } = require('./settings');
const { localDateStr } = require('../utils/localDate');
const cloud = require('./cloudBackup');
const feeEngine = require('./feeEngine');

let timer = null;
let lastDay = null;
const log = (...a) => console.log('[scheduler]', ...a);

function hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function tick(now = new Date()) {
  const db = getDb();
  const today = localDateStr(now);
  if (lastDay !== today) {
    if (lastDay) log(`New school day: ${today}`);
    lastDay = today;
    setSetting(db, 'school_day', today);
  }
  const time = hhmm(now);

  // Daily local backup
  try {
    if (getSetting(db, 'local_backup_auto', 'true') === 'true' && time >= getSetting(db, 'local_backup_time', '18:00')
      && !String(getSetting(db, 'local_backup_last', '')).startsWith(today)) {
      const b = cloud.localAutoBackup();
      log(`Daily local backup saved: ${b.fileName}`);
    }
  } catch (err) { log('Local backup failed:', err.message); }

  // Google Drive backup (daily / weekly / monthly; a failure retries hourly)
  try {
    const r = await cloud.autoDriveBackup(db, now);
    if (r) log(`Google Drive backup uploaded: ${r.file}`);
  } catch (err) { log('Google Drive backup failed (will retry in an hour):', err.message); }

  // Monthly fees
  try {
    const r = feeEngine.autoMonthlyRun(db, { now });
    if (r.ran) log(`Monthly fees for ${r.month}: ${r.created} invoice(s) created, ${r.skipped} already existed`);
  } catch (err) { log('Automatic monthly fees failed:', err.message); }
}

function start() {
  if (timer) return;
  const run = () => tick().catch((err) => log('tick failed:', err.message));
  setTimeout(run, 15000); // shortly after start-up (catch-up)
  timer = setInterval(run, 60000);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
