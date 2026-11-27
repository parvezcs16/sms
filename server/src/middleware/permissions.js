// Per-area permissions.
//
// Super Admin, Principal and Admin ("management") always have full access to
// everything, and are the only ones who can change other users' permissions.
// Every other user gets their role's defaults (below), which management can
// raise or lower per person from User Accounts → Permissions. Overrides are
// stored in user_permissions and read on every request, so a change takes
// effect immediately — no need to log out and back in.
const { getDb } = require('../db/connection');

const MANAGEMENT_ROLES = ['super_admin', 'principal', 'admin'];

const MODULES = [
  { key: 'students', label: 'Students' },
  { key: 'admissions', label: 'Admissions (enquiries & applications)' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'staff', label: 'Non-Teaching Staff' },
  { key: 'academics', label: 'Classes, Sections & Subjects' },
  { key: 'timetable', label: 'Timetable' },
  { key: 'homework', label: 'Homework & Syllabus (all classes)' },
  { key: 'attendance', label: 'Attendance (all classes, teachers & staff)' },
  { key: 'exams', label: 'Question Bank & Exam Papers' },
  { key: 'results', label: 'Marks, Progress Reports & Result Cards (all classes)' },
  { key: 'fees', label: 'Fees & Accounts' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'expenses', label: 'Daily Expenses' },
  { key: 'accounts', label: 'Accounting (cash book, other income)' },
  { key: 'library', label: 'Library' },
  { key: 'transport', label: 'Transport' },
  { key: 'inventory', label: 'Inventory / Store' },
  { key: 'events', label: 'Events & Calendar (add / change events)' },
  { key: 'communication', label: 'Communication / Notices' },
  { key: 'reports', label: 'Reports' },
  { key: 'certificates', label: 'Certificates (awards, leaving, provisional, character)' },
  { key: 'users', label: 'User Accounts' },
  { key: 'settings', label: 'Settings & Backup' }
];
const MODULE_KEYS = new Set(MODULES.map((m) => m.key));
const LABEL = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

const RANK = { none: 0, view: 1, manage: 2 };

// What each role gets before any per-user change (matches how the app behaved
// before permissions were configurable).
const ROLE_DEFAULTS = {
  accountant: { fees: 'manage', payroll: 'manage', expenses: 'manage', accounts: 'manage', reports: 'manage', students: 'view', teachers: 'view', staff: 'view', admissions: 'view', transport: 'view', inventory: 'manage' },
  teacher: { exams: 'manage', timetable: 'view', communication: 'manage', reports: 'view', students: 'view', library: 'view' },
  staff: {},
  parent: {},
  student: {}
};

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.includes(user.role));
}

function roleDefaults(role) {
  const defaults = ROLE_DEFAULTS[role] || {};
  return Object.fromEntries(MODULES.map((m) => [m.key, defaults[m.key] || 'none']));
}

function getEffectivePermissions(db, user) {
  if (!user) return roleDefaults('');
  if (isManagement(user)) return Object.fromEntries(MODULES.map((m) => [m.key, 'manage']));
  const perms = roleDefaults(user.role);
  try {
    db.prepare('SELECT module, level FROM user_permissions WHERE user_id = ?').all(user.id).forEach((row) => {
      if (MODULE_KEYS.has(row.module) && RANK[row.level] !== undefined) perms[row.module] = row.level;
    });
  } catch { /* table not created yet (first boot before migrations) */ }
  return perms;
}

function permissionsFor(req) {
  if (!req._permissions) req._permissions = getEffectivePermissions(getDb(), req.user);
  return req._permissions;
}

// hasAccess(req, 'fees', 'manage') — or an array of modules (any one is enough).
function hasAccess(req, modules, level = 'view') {
  if (isManagement(req.user)) return true;
  const perms = permissionsFor(req);
  const list = Array.isArray(modules) ? modules : [modules];
  return list.some((m) => RANK[perms[m] || 'none'] >= RANK[level]);
}

function requireAccess(modules, level = 'view') {
  return function accessGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (hasAccess(req, modules, level)) return next();
    const list = Array.isArray(modules) ? modules : [modules];
    const names = list.map((m) => LABEL[m] || m).join(' / ');
    const has = list.some((m) => RANK[permissionsFor(req)[m] || 'none'] >= RANK.view);
    const msg = level === 'manage' && has
      ? `You have view-only access to ${names}. Ask an Admin, Principal or Super Admin for permission to make changes.`
      : `You don't have access to ${names}. Ask an Admin, Principal or Super Admin to give you permission.`;
    return res.status(403).json({ error: msg });
  };
}

// Passes if ANY [module, level] pair is satisfied, e.g. a fee report is open to
// "Reports (manage)" or "Fees (view)".
function requireAccessAny(pairs) {
  return function anyAccessGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (pairs.some(([m, l]) => hasAccess(req, m, l))) return next();
    return res.status(403).json({ error: "You don't have access to this report. Ask an Admin, Principal or Super Admin to give you permission." });
  };
}

function requireManagement(req, res, next) {
  if (isManagement(req.user)) return next();
  return res.status(403).json({ error: 'Only an Admin, Principal or Super Admin can do this' });
}

module.exports = {
  MODULES, MODULE_KEYS, RANK, ROLE_DEFAULTS, MANAGEMENT_ROLES,
  isManagement, roleDefaults, getEffectivePermissions, hasAccess, requireAccess, requireAccessAny, requireManagement
};
