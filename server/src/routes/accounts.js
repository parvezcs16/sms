// Accounting: one cash book of every rupee in and out — fee payments and other
// income in; daily expenses and paid salaries out — with a running balance,
// plus an income & expenditure summary. Other income (donations, sale of
// books/uniforms, rent…) is recorded here.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { readBody } = require('../utils/crud');
const { localDateStr, DATE_RE } = require('../utils/localDate');
const { userDesignation, PAYMENT_MODES } = require('../utils/people');
const { respondWithFormat } = require('../utils/exportResponder');

const router = express.Router();
router.use(requireAuth);

const canView = (req) => ['accounts', 'fees', 'expenses', 'payroll'].some((m) => hasAccess(req, m, 'view'));
const canManage = (req) => hasAccess(req, 'accounts', 'manage');
function guard(fn) {
  return (req, res, next) => (fn(req) ? next() : next(new HttpError(403, "You don't have access to the accounts. Ask an Admin, Principal or Super Admin.")));
}

const INCOME_CATEGORIES = ['Admission / Registration', 'Donation', 'Sale of Books & Uniforms', 'Canteen', 'Rent', 'Transport (cash)', 'Bank Profit', 'Other'];
const INCOME_FIELDS = {
  income_date: { type: 'date', required: true, label: 'Date', default: () => localDateStr() },
  category: { required: true },
  amount: { type: 'num', required: true, min: 0.01 },
  received_from: {},
  payment_method: { type: 'enum', values: PAYMENT_MODES, default: 'Cash', label: 'Payment mode' },
  reference: {},
  notes: {}
};

router.get('/income', guard(canView), asyncHandler(async (req, res) => {
  const { from = '', to = '', category = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT * FROM other_income WHERE deleted_at IS NULL AND (@from = '' OR income_date >= @from) AND (@to = '' OR income_date <= @to)
       AND (@category = '' OR category = @category) ORDER BY income_date DESC, id DESC LIMIT 2000`
  ).all({ from, to, category }));
}));

router.get('/income/categories', guard(canView), (req, res) => {
  const used = getDb().prepare('SELECT DISTINCT category FROM other_income WHERE deleted_at IS NULL').all().map((r) => r.category);
  res.json([...new Set([...INCOME_CATEGORIES, ...used])]);
});

router.post('/income', guard(canManage), asyncHandler(async (req, res) => {
  const db = getDb();
  const d = readBody(INCOME_FIELDS, req.body || {}, { partial: false });
  const who = userDesignation(db, req.user.id);
  const r = db.prepare(
    `INSERT INTO other_income (income_date, category, amount, received_from, payment_method, reference, notes, recorded_by, recorded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.income_date, d.category, d.amount, d.received_from || null, d.payment_method, d.reference || null, d.notes || null, req.user.id, who.name);
  recordAudit(req, 'create', 'other_income', Number(r.lastInsertRowid), d);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

router.put('/income/:id', guard(canManage), asyncHandler(async (req, res) => {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM other_income WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!cur) throw new HttpError(404, 'Entry not found');
  const d = readBody(INCOME_FIELDS, req.body || {}, { partial: true });
  const cols = Object.keys(d);
  if (cols.length) db.prepare(`UPDATE other_income SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => d[c]), cur.id);
  recordAudit(req, 'update', 'other_income', cur.id, { before: Object.fromEntries(cols.map((c) => [c, cur[c]])), after: d });
  res.json({ success: true });
}));

router.delete('/income/:id', guard(canManage), asyncHandler(async (req, res) => {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM other_income WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!cur) throw new HttpError(404, 'Entry not found');
  db.prepare("UPDATE other_income SET deleted_at = datetime('now', 'localtime'), deleted_by = ? WHERE id = ?").run(req.user.id, cur.id);
  recordAudit(req, 'delete', 'other_income', cur.id, { amount: cur.amount, category: cur.category });
  res.json({ success: true });
}));

// Every movement of money, oldest first. `before` = everything up to (not
// including) the from-date, for the opening balance.
function entries(db, from, to) {
  const p = { from, to };
  const fees = db.prepare(
    `SELECT fp.payment_date AS date, 'in' AS dir, fp.amount, 'Fee' AS category, fp.receipt_number AS ref, fp.payment_method AS mode,
            s.full_name || ' — ' || fi.period_label AS description, COALESCE(fp.recorded_at, fp.created_at) AS sort_key
     FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students s ON s.id = fi.student_id
     WHERE fp.voided_at IS NULL AND fp.payment_method <> 'Advance' AND (@from = '' OR fp.payment_date >= @from) AND (@to = '' OR fp.payment_date <= @to)
     UNION ALL
     SELECT substr(a.created_at, 1, 10) AS date, 'in' AS dir, a.amount, 'Fee' AS category, a.receipt_number AS ref, a.payment_method AS mode,
            s.full_name || ' — Advance fee' AS description, a.created_at AS sort_key
     FROM fee_advances a JOIN students s ON s.id = a.student_id
     WHERE a.kind = 'received' AND a.voided_at IS NULL AND (@from = '' OR substr(a.created_at, 1, 10) >= @from) AND (@to = '' OR substr(a.created_at, 1, 10) <= @to)`
  ).all(p);
  const income = db.prepare(
    `SELECT income_date AS date, 'in' AS dir, amount, category, reference AS ref, payment_method AS mode,
            COALESCE(received_from, category) || CASE WHEN notes IS NOT NULL THEN ' — ' || notes ELSE '' END AS description, created_at AS sort_key
     FROM other_income WHERE deleted_at IS NULL AND (@from = '' OR income_date >= @from) AND (@to = '' OR income_date <= @to)`
  ).all(p);
  const expenses = db.prepare(
    `SELECT e.expense_date AS date, 'out' AS dir, e.amount, ec.name AS category, e.expense_number AS ref, e.payment_method AS mode,
            COALESCE(e.paid_to, ec.name) || CASE WHEN e.notes IS NOT NULL THEN ' — ' || e.notes ELSE '' END AS description, e.created_at AS sort_key
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.deleted_at IS NULL AND (@from = '' OR e.expense_date >= @from) AND (@to = '' OR e.expense_date <= @to)`
  ).all(p);
  const salaries = [];
  for (const [table, join, name] of [['payroll_runs', 'JOIN teachers x ON x.id = r.teacher_id', 'Salary (teacher)'], ['staff_payroll_runs', 'JOIN staff x ON x.id = r.staff_id', 'Salary (staff)']]) {
    salaries.push(...db.prepare(
      `SELECT substr(r.paid_at, 1, 10) AS date, 'out' AS dir, r.net_salary AS amount, '${name}' AS category, r.payslip_number AS ref, r.payment_mode AS mode,
              x.full_name || ' — ' || r.month || '/' || r.year AS description, r.paid_at AS sort_key
       FROM ${table} r ${join}
       WHERE r.status = 'Paid' AND r.paid_at IS NOT NULL AND (@from = '' OR substr(r.paid_at, 1, 10) >= @from) AND (@to = '' OR substr(r.paid_at, 1, 10) <= @to)`
    ).all(p));
  }
  return [...fees, ...income, ...expenses, ...salaries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.sort_key).localeCompare(String(b.sort_key))));
}

const r2 = (n) => Math.round(n * 100) / 100;

function readRange(q) {
  const from = DATE_RE.test(q.from || '') ? q.from : '';
  const to = DATE_RE.test(q.to || '') ? q.to : '';
  return { from, to };
}

router.get('/daybook', guard(canView), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = readRange(req.query);
  let opening = 0;
  if (from) {
    const dayBefore = localDateStr(new Date(new Date(`${from}T00:00:00`).getTime() - 86400000));
    opening = r2(entries(db, '', dayBefore).reduce((s, e) => s + (e.dir === 'in' ? e.amount : -e.amount), 0));
  }
  let bal = opening;
  const rows = entries(db, from, to).map((e) => {
    bal = r2(bal + (e.dir === 'in' ? e.amount : -e.amount));
    return { date: e.date, category: e.category, description: e.description, ref: e.ref || '', mode: e.mode || '', money_in: e.dir === 'in' ? r2(e.amount) : '', money_out: e.dir === 'out' ? r2(e.amount) : '', balance: bal };
  });
  const totalIn = r2(rows.reduce((s, r) => s + (r.money_in || 0), 0));
  const totalOut = r2(rows.reduce((s, r) => s + (r.money_out || 0), 0));
  if (req.query.format) {
    return respondWithFormat(req, res, {
      title: `Cash Book ${from || 'start'} to ${to || 'today'} — opening ${opening.toFixed(2)}, closing ${bal.toFixed(2)}`,
      fileBase: 'cash-book',
      columns: [
        { key: 'date', label: 'Date' }, { key: 'category', label: 'Head' }, { key: 'description', label: 'Details' }, { key: 'ref', label: 'Ref' },
        { key: 'money_in', label: 'In' }, { key: 'money_out', label: 'Out' }, { key: 'balance', label: 'Balance' }
      ],
      rows
    });
  }
  res.json({ from, to, opening, closing: bal, total_in: totalIn, total_out: totalOut, rows });
}));

router.get('/summary', guard(canView), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = readRange(req.query);
  const list = entries(db, from, to);
  const heads = (dir) => {
    const m = new Map();
    list.filter((e) => e.dir === dir).forEach((e) => m.set(e.category, r2((m.get(e.category) || 0) + e.amount)));
    return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  };
  const months = new Map();
  list.forEach((e) => {
    const k = e.date.slice(0, 7);
    const v = months.get(k) || { month: k, income: 0, expenditure: 0 };
    if (e.dir === 'in') v.income = r2(v.income + e.amount); else v.expenditure = r2(v.expenditure + e.amount);
    months.set(k, v);
  });
  const income = heads('in');
  const expenditure = heads('out');
  const ti = r2(income.reduce((s, x) => s + x.amount, 0));
  const te = r2(expenditure.reduce((s, x) => s + x.amount, 0));
  const byMode = new Map();
  list.forEach((e) => {
    const k = e.mode || 'Cash';
    const v = byMode.get(k) || { mode: k, money_in: 0, money_out: 0 };
    if (e.dir === 'in') v.money_in = r2(v.money_in + e.amount); else v.money_out = r2(v.money_out + e.amount);
    byMode.set(k, v);
  });
  res.json({
    from, to, income, expenditure, total_income: ti, total_expenditure: te, surplus: r2(ti - te),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, net: r2(m.income - m.expenditure) })),
    by_mode: [...byMode.values()],
    can_manage: canManage(req)
  });
}));

module.exports = router;
