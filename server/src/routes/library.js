// Library: book catalogue, issue / return to students, teachers and staff,
// overdue list and late fines.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess, requireAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { localDateStr, DATE_RE } = require('../utils/localDate');
const { getSetting, setSetting } = require('../services/settings');

const router = express.Router();
router.use(requireAuth);

const canView = (req) => hasAccess(req, 'library', 'view');
const canManage = (req) => hasAccess(req, 'library', 'manage');

mountCrud({
  router,
  path: '/books',
  table: 'library_books',
  entity: 'library_book',
  canView,
  canEdit: canManage,
  listSql: `SELECT t.*, t.copies - (SELECT COUNT(*) FROM library_issues i WHERE i.book_id = t.id AND i.returned_on IS NULL) AS available
            FROM library_books t WHERE t.archived = 0`,
  filters: {
    category: 't.category = @category',
    search: '(t.title LIKE @search OR t.author LIKE @search OR t.accession_no LIKE @search OR t.isbn LIKE @search)'
  },
  orderBy: 't.title',
  fields: {
    accession_no: { label: 'Accession no' },
    title: { required: true, max: 400 },
    author: {}, publisher: {}, isbn: { label: 'ISBN' }, category: {}, language: {}, shelf: {},
    copies: { type: 'int', min: 1, default: 1 },
    price: { type: 'num', min: 0 }
  },
  validate(db, d, existing) {
    if (existing) {
      const out = db.prepare('SELECT COUNT(*) AS c FROM library_issues WHERE book_id = ? AND returned_on IS NULL').get(existing.id).c;
      if (d.copies < out) throw new HttpError(400, `${out} copies are issued right now — copies can't be less than that`);
    }
  },
  beforeDelete(db, row) {
    const out = db.prepare('SELECT COUNT(*) AS c FROM library_issues WHERE book_id = ? AND returned_on IS NULL').get(row.id).c;
    if (out) throw new HttpError(400, 'This book is issued to someone — get it returned first');
  },
  describe: (r) => ({ title: r.title })
});

function finePerDay(db) {
  return Number(getSetting(db, 'library_fine_per_day', '0')) || 0;
}

router.get('/settings', requireAccess('library', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  res.json({ fine_per_day: finePerDay(db), loan_days: Number(getSetting(db, 'library_loan_days', '14')) || 14 });
}));

router.put('/settings', requireAccess('library', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const fine = Number(req.body.fine_per_day);
  const days = Number(req.body.loan_days);
  if (!(fine >= 0) || !(days >= 1)) throw new HttpError(400, 'Fine must be 0 or more and loan days at least 1');
  setSetting(db, 'library_fine_per_day', String(fine));
  setSetting(db, 'library_loan_days', String(Math.round(days)));
  recordAudit(req, 'update', 'library_settings', null, { fine, days });
  res.json({ success: true });
}));

function borrowerName(db, type, id) {
  const sql = {
    student: `SELECT s.full_name || ' (' || COALESCE(c.name || '-' || sec.name, s.student_code) || ')' AS n FROM students s
              LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id WHERE s.id = ? AND s.archived = 0`,
    teacher: "SELECT full_name || ' (Teacher)' AS n FROM teachers WHERE id = ? AND archived = 0",
    staff: "SELECT full_name || ' (Staff)' AS n FROM staff WHERE id = ? AND archived = 0"
  }[type];
  if (!sql) throw new HttpError(400, 'Borrower must be a student, teacher or staff member');
  const r = db.prepare(sql).get(id);
  if (!r) throw new HttpError(400, 'Borrower not found');
  return r.n;
}

function lateDays(dueOn, on) {
  const ms = new Date(`${on}T00:00:00`) - new Date(`${dueOn}T00:00:00`);
  return Math.max(0, Math.round(ms / 86400000));
}

router.get('/issues', requireAccess('library', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { status = 'open', search = '' } = req.query;
  const today = localDateStr();
  const rows = db.prepare(
    `SELECT i.*, b.title, b.accession_no, b.author FROM library_issues i JOIN library_books b ON b.id = i.book_id
     WHERE (@status = 'all' OR (@status = 'open' AND i.returned_on IS NULL) OR (@status = 'overdue' AND i.returned_on IS NULL AND i.due_on < @today)
            OR (@status = 'returned' AND i.returned_on IS NOT NULL))
       AND (@search = '' OR b.title LIKE @q OR i.borrower_name LIKE @q OR b.accession_no LIKE @q)
     ORDER BY i.returned_on IS NOT NULL, i.due_on, i.id DESC LIMIT 1000`
  ).all({ status, today, search, q: `%${search}%` });
  const fine = finePerDay(db);
  res.json(rows.map((r) => {
    const late = r.returned_on ? lateDays(r.due_on, r.returned_on) : lateDays(r.due_on, today);
    return { ...r, late_days: late, fine_due: r.returned_on ? r.fine : late * fine };
  }));
}));

router.post('/issues', requireAccess('library', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { book_id, borrower_type, borrower_id, notes } = req.body || {};
  const issued_on = req.body.issued_on || localDateStr();
  const loanDays = Number(getSetting(db, 'library_loan_days', '14')) || 14;
  const due_on = req.body.due_on || localDateStr(new Date(new Date(`${issued_on}T00:00:00`).getTime() + loanDays * 86400000));
  if (!DATE_RE.test(issued_on) || !DATE_RE.test(due_on)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
  if (due_on < issued_on) throw new HttpError(400, 'The return date is before the issue date');
  const book = db.prepare('SELECT * FROM library_books WHERE id = ? AND archived = 0').get(book_id);
  if (!book) throw new HttpError(404, 'Book not found');
  const out = db.prepare('SELECT COUNT(*) AS c FROM library_issues WHERE book_id = ? AND returned_on IS NULL').get(book.id).c;
  if (out >= book.copies) throw new HttpError(400, `All ${book.copies} copies of "${book.title}" are issued right now`);
  const name = borrowerName(db, borrower_type, Number(borrower_id));
  const r = db.prepare(
    `INSERT INTO library_issues (book_id, borrower_type, borrower_id, borrower_name, issued_on, due_on, notes, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(book.id, borrower_type, Number(borrower_id), name, issued_on, due_on, notes || null, req.user.id);
  recordAudit(req, 'issue_book', 'library_book', book.id, { to: name, due_on });
  res.status(201).json({ id: Number(r.lastInsertRowid), due_on });
}));

router.post('/issues/:id/return', requireAccess('library', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const i = db.prepare('SELECT * FROM library_issues WHERE id = ?').get(req.params.id);
  if (!i) throw new HttpError(404, 'Issue record not found');
  if (i.returned_on) throw new HttpError(400, 'This book was already returned');
  const on = req.body.returned_on || localDateStr();
  if (!DATE_RE.test(on) || on < i.issued_on) throw new HttpError(400, 'Invalid return date');
  const auto = lateDays(i.due_on, on) * finePerDay(db);
  const fine = req.body.fine === undefined || req.body.fine === '' ? auto : Number(req.body.fine);
  if (!(fine >= 0)) throw new HttpError(400, 'Fine must be 0 or more');
  db.prepare('UPDATE library_issues SET returned_on = ?, fine = ?, returned_by = ? WHERE id = ?').run(on, fine, req.user.id, i.id);
  recordAudit(req, 'return_book', 'library_book', i.book_id, { from: i.borrower_name, fine });
  res.json({ success: true, fine });
}));

router.post('/issues/:id/renew', requireAccess('library', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const i = db.prepare('SELECT * FROM library_issues WHERE id = ?').get(req.params.id);
  if (!i || i.returned_on) throw new HttpError(400, 'Only books still issued can be renewed');
  const due = req.body.due_on;
  if (!DATE_RE.test(due || '') || due < i.issued_on) throw new HttpError(400, 'Choose the new return date');
  db.prepare('UPDATE library_issues SET due_on = ? WHERE id = ?').run(due, i.id);
  recordAudit(req, 'renew_book', 'library_book', i.book_id, { to: i.borrower_name, from: i.due_on, due });
  res.json({ success: true });
}));

// People who can borrow books (for the issue form).
router.get('/borrowers', requireAccess('library', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const type = req.query.type;
  const rows = type === 'teacher'
    ? db.prepare("SELECT id, full_name AS label FROM teachers WHERE archived = 0 AND status = 'Active' ORDER BY full_name").all()
    : type === 'staff'
      ? db.prepare("SELECT id, full_name AS label FROM staff WHERE archived = 0 AND status = 'Active' ORDER BY full_name").all()
      : db.prepare(`SELECT s.id, s.full_name || ' (' || COALESCE(c.name || '-' || sec.name, '') || ') · ' || s.student_code AS label
                    FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
                    WHERE s.archived = 0 AND s.status NOT IN ('Left', 'Graduated') ORDER BY c.sort_order, sec.name, s.full_name`).all();
  res.json(rows);
}));

router.get('/stats', requireAccess('library', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const today = localDateStr();
  res.json({
    titles: db.prepare('SELECT COUNT(*) AS c FROM library_books WHERE archived = 0').get().c,
    copies: db.prepare('SELECT COALESCE(SUM(copies), 0) AS c FROM library_books WHERE archived = 0').get().c,
    issued: db.prepare('SELECT COUNT(*) AS c FROM library_issues WHERE returned_on IS NULL').get().c,
    overdue: db.prepare('SELECT COUNT(*) AS c FROM library_issues WHERE returned_on IS NULL AND due_on < ?').get(today).c
  });
}));

module.exports = router;
