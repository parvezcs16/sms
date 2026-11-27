const bcrypt = require('bcryptjs');

const ROLES = ['super_admin', 'principal', 'admin', 'accountant', 'teacher', 'staff', 'parent', 'student'];
const DEFAULT_SETTINGS = {
  school_name: 'Greenwood High School',
  academic_year: String(new Date().getFullYear()),
  currency: 'PKR',
  address: '',
  late_fee_per_day: '0',
  school_logo: '',
  default_country_code: '',
  auto_send_fee_vouchers: 'false',
  auto_send_fee_receipts: 'false'
};

// Minimal, idempotent bootstrap so the app is usable on first run.
// Rich demo data lives in scripts/seed-demo-data.js (see docs/installation-guide.md).
function ensureSeed(db) {
  // INSERT OR IGNORE (not gated by "table is empty") so a new role added in a
  // later version — e.g. 'staff' — gets created for schools upgrading from an
  // older install too, not just on a brand-new database.
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)');
  for (const name of ROLES) insertRole.run(name);

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const superAdminRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('super_admin');
    const passwordHash = bcrypt.hashSync('Admin@123', 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, role_id, full_name, email, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run('admin', passwordHash, superAdminRole.id, 'System Administrator', 'admin@school.local');
  }

  const settingRows = db.prepare('SELECT key FROM settings').all();
  const existingKeys = new Set(settingRows.map((r) => r.key));
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!existingKeys.has(key)) insertSetting.run(key, value);
  }

  const periodCount = db.prepare('SELECT COUNT(*) AS c FROM periods').get().c;
  if (periodCount === 0) {
    const insertPeriod = db.prepare('INSERT INTO periods (name, start_time, end_time, order_index) VALUES (?, ?, ?, ?)');
    const defaults = [
      ['Period 1', '08:00', '08:45'],
      ['Period 2', '08:45', '09:30'],
      ['Period 3', '09:30', '10:15'],
      ['Break', '10:15', '10:35'],
      ['Period 4', '10:35', '11:20'],
      ['Period 5', '11:20', '12:05'],
      ['Period 6', '12:05', '12:50'],
      ['Period 7', '12:50', '13:35']
    ];
    defaults.forEach(([name, start, end], idx) => insertPeriod.run(name, start, end, idx));
  }
}

module.exports = { ensureSeed, ROLES };
