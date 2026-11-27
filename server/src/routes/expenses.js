const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { localDateStr } = require('../utils/localDate');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { upload } = require('../middleware/upload');
const ids = require('../utils/ids');
const { respondWithFormat } = require('../utils/exportResponder');
const { buildPartialUpdate } = require('../utils/partialUpdate');
const { friendlyConstraint } = require('../utils/tx');

const router = express.Router();
router.use(requireAuth);
const ACCOUNTS = [...ROLE_GROUPS.staffAdmin];

router.get('/categories', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM expense_categories ORDER BY name').all());
}));

router.post('/categories', requireAccess('expenses', 'manage'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new HttpError(400, 'name is required');
  const result = getDb().prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.get('/', requireAccess('expenses', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from = '', to = '', category_id = '', search = '', include_deleted = 'false' } = req.query;
  const q = `%${search}%`;
  const deletedFilter = include_deleted === 'true' ? '' : 'AND e.deleted_at IS NULL';
  const rows = db.prepare(
    `SELECT e.*, ec.name AS category_name, u.full_name AS recorded_by_name, du.full_name AS deleted_by_name,
            (SELECT COUNT(*) FROM audit_logs a WHERE a.entity_type = 'expense' AND a.entity_id = e.id AND a.action = 'update') AS edit_count
     FROM expenses e
     JOIN expense_categories ec ON ec.id = e.category_id
     LEFT JOIN users u ON u.id = e.recorded_by
     LEFT JOIN users du ON du.id = e.deleted_by
     WHERE 1 = 1 ${deletedFilter}
       AND (@from = '' OR e.expense_date >= @from)
       AND (@to = '' OR e.expense_date <= @to)
       AND (@category_id = '' OR e.category_id = @category_id)
       AND (@search = '' OR e.paid_to LIKE @q OR e.expense_number LIKE @q OR e.notes LIKE @q)
     ORDER BY e.expense_date DESC, e.id DESC`
  ).all({ from, to, category_id, search, q });
  res.json(rows);
}));

router.get('/summary', requireAccess('expenses', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const today = localDateStr();
  const monthStart = `${today.slice(0, 7)}-01`;
  const todayTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE expense_date = ? AND deleted_at IS NULL`).get(today).s;
  const monthTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE expense_date >= ? AND deleted_at IS NULL`).get(monthStart).s;
  const byCategory = db.prepare(
    `SELECT ec.name AS category, COALESCE(SUM(e.amount),0) AS total FROM expense_categories ec
     LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date >= ? AND e.deleted_at IS NULL
     GROUP BY ec.id ORDER BY total DESC`
  ).all(monthStart);
  res.json({ todayTotal, monthTotal, byCategory });
}));

router.post('/', requireAccess('expenses', 'manage'), upload.single('receipt'), asyncHandler(async (req, res) => {
  const { category_id, expense_date, amount, paid_to, payment_method, notes } = req.body;
  if (!category_id || !amount) throw new HttpError(400, 'category_id and amount are required');
  const db = getDb();
  const expenseNumber = ids.expenseNumber(db);
  const result = db.prepare(
    `INSERT INTO expenses (expense_number, category_id, expense_date, amount, paid_to, payment_method, notes, receipt_path, recorded_by)
     VALUES (?, ?, COALESCE(?, date('now', 'localtime')), ?, ?, ?, ?, ?, ?)`
  ).run(expenseNumber, category_id, expense_date || null, amount, paid_to || null, payment_method || 'Cash', notes || null, req.file ? req.file.filename : null, req.user.id);
  recordAudit(req, 'create', 'expense', Number(result.lastInsertRowid), { amount, category_id, expense_date: expense_date || null, paid_to: paid_to || null, payment_method: payment_method || 'Cash' });
  res.status(201).json({ id: Number(result.lastInsertRowid), expense_number: expenseNumber });
}));

router.put('/:id', requireAccess('expenses', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!before) throw new HttpError(404, 'Expense not found');
  const body = req.body || {};
  if (body.amount !== undefined && !(Number(body.amount) > 0)) throw new HttpError(400, 'Amount must be more than 0');
  const { sql, values } = buildPartialUpdate('expenses', ['category_id', 'expense_date', 'amount', 'paid_to', 'payment_method', 'notes'], body, ['category_id', 'expense_date', 'amount', 'payment_method']);
  if (before.deleted_at) throw new HttpError(400, 'This expense was deleted — restore it first to edit it');
  if (sql) db.prepare(`${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, before.id);
  const changes = {};
  ['category_id', 'expense_date', 'amount', 'paid_to', 'payment_method', 'notes'].forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(body, f) && String(body[f] ?? '') !== String(before[f] ?? '')) changes[f] = { from: before[f], to: body[f] };
  });
  recordAudit(req, 'update', 'expense', before.id, { changes });
  res.json({ success: true });
}));

router.put('/categories/:id', requireAccess('expenses', 'manage'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  try {
    getDb().prepare('UPDATE expense_categories SET name = ? WHERE id = ?').run(name, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A category with that name already exists' });
  }
  recordAudit(req, 'update', 'expense_category', Number(req.params.id), { name });
  res.json({ success: true });
}));

// "Delete" never erases an expense — it is marked deleted (who, when, why) and
// drops out of totals, but stays visible under "Show deleted" and in History.
router.delete('/:id', requireAccess('expenses', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Expense not found');
  if (row.deleted_at) return res.json({ success: true });
  const reason = String((req.body && req.body.reason) || req.query.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Please give a reason for deleting this expense');
  db.prepare('UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_reason = ? WHERE id = ?').run(req.user.id, reason, row.id);
  recordAudit(req, 'delete', 'expense', row.id, { reason, amount: row.amount, expense_number: row.expense_number, expense_date: row.expense_date });
  res.json({ success: true });
}));

router.post('/:id/restore', requireAccess('expenses', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare('UPDATE expenses SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = ?').run(req.params.id);
  recordAudit(req, 'restore', 'expense', Number(req.params.id));
  res.json({ success: true });
}));

router.get('/report', requireAccess('expenses', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from = '', to = '' } = req.query;
  const rows = db.prepare(
    `SELECT e.expense_number, e.expense_date, ec.name AS category_name, e.amount, e.paid_to, e.payment_method
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.deleted_at IS NULL AND (@from = '' OR e.expense_date >= @from) AND (@to = '' OR e.expense_date <= @to)
     ORDER BY e.expense_date DESC`
  ).all({ from, to });

  await respondWithFormat(req, res, {
    title: 'Expense Report',
    fileBase: 'expense-report',
    columns: [
      { key: 'expense_number', label: 'Expense No' }, { key: 'expense_date', label: 'Date' }, { key: 'category_name', label: 'Category' },
      { key: 'amount', label: 'Amount' }, { key: 'paid_to', label: 'Paid To' }, { key: 'payment_method', label: 'Method' }
    ],
    rows
  });
}));

module.exports = router;
