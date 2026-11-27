const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { localDateStr } = require('../utils/localDate');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errors');
const { hasAccess } = require('../middleware/permissions');
const { DATE_RE } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);

router.get('/admin', asyncHandler(async (req, res) => {
  const db = getDb();
  const today = localDateStr();
  const monthStart = today.slice(0, 7) + '-01';

  const studentCount = db.prepare('SELECT COUNT(*) AS c FROM students WHERE archived = 0 AND status NOT IN (\'Left\', \'Graduated\')').get().c;
  const teacherCount = db.prepare('SELECT COUNT(*) AS c FROM teachers WHERE archived = 0').get().c;
  const staffCount = db.prepare('SELECT COUNT(*) AS c FROM staff WHERE archived = 0').get().c;
  const presentToday = db.prepare(`SELECT COUNT(*) AS c FROM student_attendance WHERE attendance_date = ? AND status = 'Present'`).get(today).c;
  const markedToday = db.prepare(`SELECT COUNT(*) AS c FROM student_attendance WHERE attendance_date = ?`).get(today).c;
  const feeCollectionToday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM fee_cash_in WHERE payment_date = ? AND voided_at IS NULL`).get(today).s;
  const feeCollectionMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM fee_cash_in WHERE payment_date >= ? AND voided_at IS NULL`).get(monthStart).s;
  const pendingDues = db.prepare(`SELECT COALESCE(SUM(total_amount + fine_amount - paid_amount),0) AS s FROM fee_invoices WHERE status NOT IN ('Paid', 'Cancelled')`).get().s;
  const expensesToday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE expense_date = ? AND deleted_at IS NULL`).get(today).s;
  const expensesMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE expense_date >= ? AND deleted_at IS NULL`).get(monthStart).s;
  const upcomingExams = db.prepare(
    `SELECT ep.id, ep.title, ep.scheduled_date, sub.name AS subject_name, c.name AS class_name
     FROM exam_papers ep LEFT JOIN subjects sub ON sub.id = ep.subject_id LEFT JOIN classes c ON c.id = ep.class_id
     WHERE ep.scheduled_date >= ? ORDER BY ep.scheduled_date LIMIT 5`
  ).all(today);
  const recentNotifications = db.prepare('SELECT id, title, category, created_at FROM notifications ORDER BY created_at DESC LIMIT 5').all();
  const pendingLeaves = db.prepare(
    `SELECT (SELECT COUNT(*) FROM teacher_leaves WHERE status = 'Pending') + (SELECT COUNT(*) FROM staff_leaves WHERE status = 'Pending') AS c`
  ).get().c;

  const classCount = db.prepare('SELECT COUNT(*) AS c FROM classes').get().c;
  const sectionCount = db.prepare('SELECT COUNT(*) AS c FROM sections').get().c;
  const attendanceToday = { Present: 0, Absent: 0, Late: 0, Leave: 0 };
  db.prepare('SELECT status, COUNT(*) AS c FROM student_attendance WHERE attendance_date = ? GROUP BY status').all(today)
    .forEach((r) => { attendanceToday[r.status] = (attendanceToday[r.status] || 0) + r.c; });
  const pendingStudents = db.prepare(
    `SELECT COUNT(DISTINCT student_id) AS c FROM fee_invoices WHERE status NOT IN ('Paid', 'Cancelled') AND total_amount + fine_amount - paid_amount > 0`
  ).get().c;

  // This month's fee target: everything billed with a due date this month.
  const monthEnd = lastDayOf(today.slice(0, 7));
  const feeBilledMonth = db.prepare(
    `SELECT COALESCE(SUM(total_amount + fine_amount),0) AS s FROM fee_invoices WHERE due_date BETWEEN ? AND ? AND status != 'Cancelled'`
  ).get(monthStart, monthEnd).s;
  const lm = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1);
  const lmYm = `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}`;
  // Same stretch of last month (1st to today's day), for a fair comparison.
  const lmTo = `${lmYm}-${pad(Math.min(Number(today.slice(8, 10)), Number(lastDayOf(lmYm).slice(8, 10))))}`;
  const feeCollectionLastMonthToDate = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM fee_cash_in WHERE payment_date BETWEEN ? AND ? AND voided_at IS NULL`
  ).get(`${lmYm}-01`, lmTo).s;

  // Last 6 months: fees in vs. expenses and salaries out.
  const monthly = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const f = financeFor(db, `${ym}-01`, lastDayOf(ym));
    monthly.push({ month: ym, fees: f.fees.total, expenses: f.expenses.total, salaries: f.salaries.total });
  }

  // Upcoming exams: date sheet entries plus scheduled papers.
  const upcomingSchedule = db.prepare(
    `SELECT 'ds-' || t.id AS id, sub.name AS subject_name, c.name AS class_name, t.exam_date AS scheduled_date, t.start_time
     FROM exam_schedule t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
     WHERE t.archived = 0 AND t.exam_date >= ? ORDER BY t.exam_date, t.start_time LIMIT 6`
  ).all(today);
  const upcoming = [
    ...upcomingSchedule.map((e) => ({ ...e, title: `${e.subject_name} Exam` })),
    ...upcomingExams.map((e) => ({ ...e, id: `ep-${e.id}` }))
  ].sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date))).slice(0, 5);

  // Recent activity from fees, admissions, attendance and expenses.
  const classLabel = `COALESCE(c.name || CASE WHEN sec.name IS NOT NULL THEN '-' || sec.name ELSE '' END, '')`;
  const activities = [
    ...db.prepare(
      `SELECT 'fee' AS kind, fp.id, fp.amount, fp.created_at AS at, s.full_name AS name, ${classLabel} AS class_label
       FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students s ON s.id = fi.student_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       WHERE fp.voided_at IS NULL ORDER BY fp.created_at DESC LIMIT 6`
    ).all(),
    ...db.prepare(
      `SELECT 'student' AS kind, s.id, NULL AS amount, s.created_at AS at, s.full_name AS name, ${classLabel} AS class_label
       FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       WHERE s.archived = 0 ORDER BY s.created_at DESC LIMIT 6`
    ).all(),
    ...db.prepare(
      `SELECT 'attendance' AS kind, sa.section_id AS id, COUNT(*) AS amount, MAX(sa.marked_at) AS at, NULL AS name, ${classLabel} AS class_label
       FROM student_attendance sa JOIN sections sec ON sec.id = sa.section_id JOIN classes c ON c.id = sec.class_id
       WHERE sa.attendance_date >= date(?, '-7 day')
       GROUP BY sa.section_id, sa.attendance_date ORDER BY at DESC LIMIT 6`
    ).all(today),
    ...db.prepare(
      `SELECT 'expense' AS kind, e.id, e.amount, e.created_at AS at, COALESCE(NULLIF(e.paid_to, ''), ec.name) AS name, ec.name AS class_label
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 6`
    ).all()
  ].filter((a) => a.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);

  // Money is only for people with Fees / Expenses access — a teacher (or any
  // other login) never gets fee collections, dues or the fee / expense history.
  const canFees = hasAccess(req, 'fees', 'view');
  const canExpenses = hasAccess(req, 'expenses', 'view');
  const canFinance = canFees && canExpenses && hasAccess(req, 'payroll', 'view');
  const hide = (allowed, v) => (allowed ? v : null);
  res.json({
    studentCount, teacherCount, staffCount, classCount, sectionCount, presentToday, markedToday, attendanceToday,
    feeCollectionToday: hide(canFees, feeCollectionToday), feeCollectionMonth: hide(canFees, feeCollectionMonth),
    feeBilledMonth: hide(canFees, feeBilledMonth), feeCollectionLastMonthToDate: hide(canFees, feeCollectionLastMonthToDate),
    pendingDues: hide(canFees, pendingDues), pendingStudents: hide(canFees, pendingStudents), pendingLeaves,
    expensesToday: hide(canExpenses, expensesToday), expensesMonth: hide(canExpenses, expensesMonth),
    monthly: canFinance ? monthly : [],
    upcomingExams: upcoming, recentNotifications,
    recentActivities: activities.filter((a) => (a.kind === 'fee' ? canFees : a.kind === 'expense' ? canExpenses : true))
  });
}));

router.get('/teacher', asyncHandler(async (req, res) => {
  if (!req.user.teacher_id) throw new HttpError(400, 'No teacher profile linked to this account');
  const db = getDb();
  const today = new Date();
  const dayOfWeek = today.getDay();
  const todayStr = localDateStr(today);

  const todaysClasses = db.prepare(
    `SELECT te.*, sub.name AS subject_name, sec.name AS section_name, c.name AS class_name, r.name AS room_name, p.name AS period_name, p.start_time
     FROM timetable_entries te
     JOIN subjects sub ON sub.id = te.subject_id
     JOIN sections sec ON sec.id = te.section_id
     JOIN classes c ON c.id = sec.class_id
     LEFT JOIN rooms r ON r.id = te.room_id
     JOIN periods p ON p.id = te.period_id
     WHERE te.teacher_id = ? AND te.day_of_week = ? ORDER BY p.order_index`
  ).all(req.user.teacher_id, dayOfWeek);

  const assignedSubjects = db.prepare(
    `SELECT DISTINCT sub.name AS subject_name FROM class_subject_teachers cst JOIN subjects sub ON sub.id = cst.subject_id WHERE cst.teacher_id = ?`
  ).all(req.user.teacher_id);

  const myAttendanceToday = db.prepare('SELECT status FROM teacher_attendance WHERE teacher_id = ? AND attendance_date = ?').get(req.user.teacher_id, todayStr);
  const questionCount = db.prepare('SELECT COUNT(*) AS c FROM question_bank WHERE created_by = ? AND archived = 0').get(req.user.id).c;

  res.json({ todaysClasses, assignedSubjects, myAttendanceStatus: myAttendanceToday ? myAttendanceToday.status : 'Not marked', questionCount });
}));

router.get('/accountant', asyncHandler(async (req, res) => {
  if (!['fees', 'payroll', 'expenses'].some((m) => hasAccess(req, m, 'view'))) throw new HttpError(403, "You don't have access to fees.");
  const db = getDb();
  const today = localDateStr();
  const monthStart = today.slice(0, 7) + '-01';
  const feeCollectionToday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM fee_cash_in WHERE payment_date = ? AND voided_at IS NULL`).get(today).s;
  const feeCollectionMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM fee_cash_in WHERE payment_date >= ? AND voided_at IS NULL`).get(monthStart).s;
  const pendingFees = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_amount + fine_amount - paid_amount),0) AS total FROM fee_invoices WHERE status NOT IN ('Paid', 'Cancelled')`).get();
  const month = today.slice(5, 7).replace(/^0/, '');
  const year = today.slice(0, 4);
  const payrollThisMonth = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM payroll_runs WHERE month = @month AND year = @year) + (SELECT COUNT(*) FROM staff_payroll_runs WHERE month = @month AND year = @year) AS c,
       (SELECT COALESCE(SUM(net_salary),0) FROM payroll_runs WHERE month = @month AND year = @year) + (SELECT COALESCE(SUM(net_salary),0) FROM staff_payroll_runs WHERE month = @month AND year = @year) AS total`
  ).get({ month, year });
  const expensesMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE expense_date >= ? AND deleted_at IS NULL`).get(`${today.slice(0, 7)}-01`).s;

  res.json({ feeCollectionToday, feeCollectionMonth, pendingFeesCount: pendingFees.c, pendingFeesTotal: pendingFees.total, payrollThisMonth, expensesMonth });
}));

// ---- Finance summary: fees collected, salaries, expenses, profit / loss ----
const pad = (n) => String(n).padStart(2, '0');
function lastDayOf(ym) { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; }

function periodRange(period, from, to) {
  const today = localDateStr();
  const ym = today.slice(0, 7);
  if (period === 'custom') {
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw new HttpError(400, 'from and to (YYYY-MM-DD) are required for a custom range');
    if (from > to) throw new HttpError(400, '"From" must be on or before "To"');
    return { from, to, label: `${from} to ${to}` };
  }
  if (period === 'today') return { from: today, to: today, label: 'Today' };
  if (period === 'last_month') {
    const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
    const lm = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    return { from: `${lm}-01`, to: lastDayOf(lm), label: 'Last month' };
  }
  if (period === 'year') {
    // Academic-style: calendar year to date.
    return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'This year' };
  }
  return { from: `${ym}-01`, to: lastDayOf(ym), label: 'This month' };
}

function financeFor(db, from, to) {
  const fees = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM fee_cash_in
     WHERE payment_date BETWEEN ? AND ?`
  ).get(from, to);
  // Discounts given at the counter: income the school chose not to take.
  const discounts = db.prepare(
    `SELECT COALESCE(SUM(discount_amount),0) AS total, COUNT(*) AS count FROM fee_payments
     WHERE payment_date BETWEEN ? AND ? AND voided_at IS NULL AND discount_amount > 0`
  ).get(from, to);
  const expenses = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM expenses
     WHERE expense_date BETWEEN ? AND ? AND deleted_at IS NULL`
  ).get(from, to);
  // Salaries belong to the payroll month they were generated for.
  const fromYm = from.slice(0, 7);
  const toYm = to.slice(0, 7);
  const salaryQuery = (table) => db.prepare(
    `SELECT COALESCE(SUM(net_salary),0) AS total,
            COALESCE(SUM(CASE WHEN status = 'Paid' THEN net_salary ELSE 0 END),0) AS paid,
            COUNT(*) AS count
     FROM ${table} WHERE printf('%04d-%02d', year, month) BETWEEN ? AND ?`
  ).get(fromYm, toYm);
  const t = salaryQuery('payroll_runs');
  const st = salaryQuery('staff_payroll_runs');
  const salaries = {
    total: t.total + st.total, paid: t.paid + st.paid, pending: (t.total - t.paid) + (st.total - st.paid),
    teachers: t.total, staff: st.total, count: t.count + st.count
  };
  const round = (n) => Math.round(n * 100) / 100;
  const profit = round(fees.total - salaries.total - expenses.total);
  return {
    fees: { total: round(fees.total), count: fees.count },
    salaries: { ...salaries, total: round(salaries.total), paid: round(salaries.paid), pending: round(salaries.pending) },
    expenses: { total: round(expenses.total), count: expenses.count },
    discounts: { total: round(discounts.total), count: discounts.count },
    profit
  };
}

router.get('/finance', asyncHandler(async (req, res) => {
  const allowed = ['fees', 'payroll', 'expenses'].some((m) => hasAccess(req, m, 'view'));
  if (!allowed) throw new HttpError(403, "You don't have access to the finance summary. Ask an Admin, Principal or Super Admin.");
  const db = getDb();
  const { period = 'month', from, to } = req.query;
  const range = periodRange(period, from, to);
  const summary = financeFor(db, range.from, range.to);

  // Last 6 months, for the trend table.
  const today = localDateStr();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const f = financeFor(db, `${ym}-01`, lastDayOf(ym));
    months.push({ month: ym, fees: f.fees.total, salaries: f.salaries.total, expenses: f.expenses.total, profit: f.profit });
  }
  res.json({ period, ...range, ...summary, months });
}));

// Outstanding fees, class by class (with each section), for the dashboard drill-down.
router.get('/outstanding', asyncHandler(async (req, res) => {
  if (!hasAccess(req, 'fees', 'view')) throw new HttpError(403, "You don't have access to fees. Ask an Admin, Principal or Super Admin.");
  const db = getDb();
  const today = localDateStr();
  const rows = db.prepare(
    `SELECT c.id AS class_id, COALESCE(c.name, 'No class') AS class_name, COALESCE(c.sort_order, 9999) AS sort_order,
            sec.id AS section_id, sec.name AS section_name,
            COUNT(DISTINCT fi.student_id) AS students, COUNT(*) AS invoices,
            COALESCE(SUM(fi.total_amount + fi.fine_amount - fi.paid_amount),0) AS outstanding,
            COALESCE(SUM(CASE WHEN fi.due_date < ? THEN fi.total_amount + fi.fine_amount - fi.paid_amount ELSE 0 END),0) AS overdue
     FROM fee_invoices fi
     JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE fi.status NOT IN ('Paid', 'Cancelled') AND fi.total_amount + fi.fine_amount - fi.paid_amount > 0
     GROUP BY c.id, sec.id
     ORDER BY sort_order, class_name, section_name`
  ).all(today);
  const round = (n) => Math.round(n * 100) / 100;
  const classes = [];
  const byId = new Map();
  rows.forEach((r) => {
    const key = r.class_id == null ? 'none' : r.class_id;
    if (!byId.has(key)) {
      const entry = { class_id: r.class_id, class_name: r.class_name, students: 0, invoices: 0, outstanding: 0, overdue: 0, sections: [] };
      byId.set(key, entry);
      classes.push(entry);
    }
    const e = byId.get(key);
    e.students += r.students; e.invoices += r.invoices; e.outstanding += r.outstanding; e.overdue += r.overdue;
    e.sections.push({ section_id: r.section_id, section_name: r.section_name || '—', students: r.students, invoices: r.invoices, outstanding: round(r.outstanding), overdue: round(r.overdue) });
  });
  classes.forEach((c) => { c.outstanding = round(c.outstanding); c.overdue = round(c.overdue); });
  const total = round(classes.reduce((s, c) => s + c.outstanding, 0));
  res.json({ total, students: classes.reduce((s, c) => s + c.students, 0), classes });
}));

// Global search across students/teachers/invoices, used by the top-bar search box.
router.get('/search', asyncHandler(async (req, res) => {
  const db = getDb();
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ students: [], teachers: [], staff: [], invoices: [] });
  const like = `%${q}%`;
  const students = db.prepare(
    `SELECT id, full_name, student_code FROM students WHERE archived = 0 AND (full_name LIKE ? OR student_code LIKE ? OR admission_number LIKE ?) LIMIT 8`
  ).all(like, like, like);
  const teachers = db.prepare(
    `SELECT id, full_name, teacher_code FROM teachers WHERE archived = 0 AND (full_name LIKE ? OR teacher_code LIKE ?) LIMIT 8`
  ).all(like, like);
  const staff = db.prepare(
    `SELECT id, full_name, staff_code FROM staff WHERE archived = 0 AND (full_name LIKE ? OR staff_code LIKE ?) LIMIT 8`
  ).all(like, like);
  const invoices = db.prepare(
    `SELECT id, invoice_number, student_id FROM fee_invoices WHERE invoice_number LIKE ? LIMIT 8`
  ).all(like);
  res.json({ students, teachers, staff, invoices });
}));

module.exports = router;
