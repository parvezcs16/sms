const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { respondWithFormat } = require('../utils/exportResponder');
const { requireAccess, requireAccessAny } = require('../middleware/permissions');
const { localDateStr } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);
const STAFF = [...ROLE_GROUPS.staffAdmin, 'principal'];

router.get('/attendance-summary', requireAccess(['reports', 'attendance'], 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { section_id = '', from, to } = req.query;
  const rows = db.prepare(
    `SELECT s.full_name, s.student_code, s.roll_number, c.name AS class_name, sec.name AS section_name,
       SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
       SUM(CASE WHEN sa.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
       SUM(CASE WHEN sa.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
       SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) AS late_days,
       COUNT(sa.id) AS total_marked
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN student_attendance sa ON sa.student_id = s.id
       AND (@from IS NULL OR sa.attendance_date >= @from) AND (@to IS NULL OR sa.attendance_date <= @to)
     WHERE s.archived = 0 AND s.status NOT IN ('Left', 'Graduated') AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     GROUP BY s.id ORDER BY c.sort_order, sec.name, s.roll_number`
  ).all({ section_id, class_id: req.query.class_id || '', from: from || null, to: to || null });

  // Sr No, attendance % and the period make the printed sheet easy to read.
  const ordered = rows.map((r, i) => ({
    sr: i + 1, full_name: r.full_name, student_code: r.student_code, roll_number: r.roll_number, class_name: r.class_name, section_name: r.section_name,
    present_days: r.present_days, leave_days: r.leave_days, absent_days: r.absent_days, late_days: r.late_days, total_marked: r.total_marked,
    percent: r.total_marked ? `${Math.round(((r.present_days + r.late_days) / r.total_marked) * 100)}%` : '-'
  }));
  const { toDmy } = require('../utils/dmy');
  const scope = section_id ? (db.prepare('SELECT c.name || \' - \' || sec.name AS n FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ?').get(section_id) || {}).n
    : req.query.class_id ? (db.prepare('SELECT name AS n FROM classes WHERE id = ?').get(req.query.class_id) || {}).n : 'All classes';
  const period = from || to ? `${from ? toDmy(from) : 'start'} to ${to ? toDmy(to) : 'today'}` : 'All dates';
  await respondWithFormat(req, res, {
    title: 'Student Attendance Summary',
    subtitle: `${scope || 'All classes'}  ·  ${period}`,
    fileBase: 'student-attendance-summary',
    columns: [
      { key: 'sr', label: 'Sr', width: 22, align: 'center' }, { key: 'full_name', label: 'Full Name' }, { key: 'student_code', label: 'Student ID', width: 68 },
      { key: 'roll_number', label: 'Roll No', width: 30, align: 'center' }, { key: 'class_name', label: 'Class', width: 44 }, { key: 'section_name', label: 'Section', width: 42, align: 'center' },
      { key: 'present_days', label: 'Present', width: 42, align: 'center' }, { key: 'leave_days', label: 'Leave', width: 34, align: 'center' },
      { key: 'absent_days', label: 'Absent', width: 40, align: 'center' }, { key: 'late_days', label: 'Late', width: 28, align: 'center' },
      { key: 'total_marked', label: 'Total Marked', width: 40, align: 'center' }, { key: 'percent', label: 'Percent', width: 44, align: 'center' }
    ],
    rows: ordered
  });
}));

router.get('/teacher-attendance-summary', requireAccessAny([['reports', 'manage'], ['attendance', 'manage']]), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const rows = db.prepare(
    `SELECT t.id, t.full_name, t.teacher_code,
       SUM(CASE WHEN ta.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
       SUM(CASE WHEN ta.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
       SUM(CASE WHEN ta.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
       COUNT(ta.id) AS total_marked
     FROM teachers t
     LEFT JOIN teacher_attendance ta ON ta.teacher_id = t.id
       AND (@from IS NULL OR ta.attendance_date >= @from) AND (@to IS NULL OR ta.attendance_date <= @to)
     WHERE t.archived = 0
     GROUP BY t.id ORDER BY t.full_name`
  ).all({ from: from || null, to: to || null });

  await respondWithFormat(req, res, {
    title: 'Teacher Attendance Summary',
    fileBase: 'teacher-attendance-summary',
    columns: [
      { key: 'full_name', label: 'Teacher' }, { key: 'present_days', label: 'Present' },
      { key: 'absent_days', label: 'Absent' }, { key: 'leave_days', label: 'Leave' }, { key: 'total_marked', label: 'Total Marked' }
    ],
    rows
  });
}));

router.get('/fee-collection', requireAccessAny([['reports', 'manage'], ['fees', 'view']]), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to, section_id = '', class_id = '' } = req.query;
  const rows = db.prepare(
    `SELECT fp.receipt_number, fp.payment_date, fp.amount, fp.payment_method, s.full_name AS student_name, s.student_code,
            c.name || ' - ' || sec.name AS class_name, fi.period_label, COALESCE(fp.received_by_name, '') AS received_by
     FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE fp.voided_at IS NULL AND (@from IS NULL OR fp.payment_date >= @from) AND (@to IS NULL OR fp.payment_date <= @to)
       AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY fp.payment_date DESC`
  ).all({ from: from || null, to: to || null, section_id, class_id });

  await respondWithFormat(req, res, {
    title: 'Fee Collection Report',
    fileBase: 'fee-collection',
    columns: [
      { key: 'receipt_number', label: 'Receipt No' }, { key: 'payment_date', label: 'Date' }, { key: 'student_name', label: 'Student' },
      { key: 'class_name', label: 'Class' }, { key: 'period_label', label: 'Fee Month' }, { key: 'amount', label: 'Amount' }, { key: 'payment_method', label: 'Method' }, { key: 'received_by', label: 'Received By' }
    ],
    rows
  });
}));

router.get('/payroll-summary', requireAccessAny([['reports', 'manage'], ['payroll', 'view']]), asyncHandler(async (req, res) => {
  const db = getDb();
  const { month = '', year = '' } = req.query;
  const rows = db.prepare(
    `SELECT pr.*, t.full_name AS teacher_name FROM payroll_runs pr JOIN teachers t ON t.id = pr.teacher_id
     WHERE (@month = '' OR pr.month = @month) AND (@year = '' OR pr.year = @year)
     ORDER BY pr.year DESC, pr.month DESC`
  ).all({ month, year });

  await respondWithFormat(req, res, {
    title: 'Payroll Summary',
    fileBase: 'payroll-summary',
    columns: [
      { key: 'teacher_name', label: 'Teacher' }, { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' },
      { key: 'net_salary', label: 'Net Salary' }, { key: 'status', label: 'Status' }
    ],
    rows
  });
}));

router.get('/class-wise', requireAccess('reports', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.name AS class_name, sec.name AS section_name,
       COUNT(s.id) AS total_students,
       SUM(CASE WHEN s.gender = 'Male' THEN 1 ELSE 0 END) AS male_count,
       SUM(CASE WHEN s.gender = 'Female' THEN 1 ELSE 0 END) AS female_count
     FROM sections sec JOIN classes c ON c.id = sec.class_id
     LEFT JOIN students s ON s.section_id = sec.id AND s.archived = 0
     GROUP BY sec.id ORDER BY c.sort_order, sec.name`
  ).all();

  await respondWithFormat(req, res, {
    title: 'Class-wise Report',
    fileBase: 'class-wise-report',
    columns: [
      { key: 'class_name', label: 'Class' }, { key: 'section_name', label: 'Section' },
      { key: 'total_students', label: 'Total' }, { key: 'male_count', label: 'Male' }, { key: 'female_count', label: 'Female' }
    ],
    rows
  });
}));

router.get('/teacher-performance', requireAccess('reports', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT t.id, t.full_name, t.teacher_code,
       (SELECT COUNT(*) FROM teacher_attendance ta WHERE ta.teacher_id = t.id AND ta.status = 'Present') AS present_days,
       (SELECT COUNT(*) FROM teacher_attendance ta WHERE ta.teacher_id = t.id) AS total_days,
       (SELECT COUNT(*) FROM teacher_leaves tl WHERE tl.teacher_id = t.id AND tl.status = 'Approved') AS approved_leaves,
       (SELECT COUNT(*) FROM class_subject_teachers cst WHERE cst.teacher_id = t.id) AS classes_assigned,
       (SELECT COUNT(*) FROM question_bank qb WHERE qb.created_by = t.user_id) AS questions_authored
     FROM teachers t WHERE t.archived = 0 ORDER BY t.full_name`
  ).all();

  await respondWithFormat(req, res, {
    title: 'Teacher Performance Report',
    fileBase: 'teacher-performance',
    columns: [
      { key: 'full_name', label: 'Teacher' }, { key: 'present_days', label: 'Present Days' }, { key: 'total_days', label: 'Total Days' },
      { key: 'approved_leaves', label: 'Approved Leaves' }, { key: 'classes_assigned', label: 'Classes Assigned' }, { key: 'questions_authored', label: 'Questions Authored' }
    ],
    rows
  });
}));

router.get('/exam-summary', requireAccess(['reports', 'exams'], 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT sub.name AS subject_name, COUNT(DISTINCT qb.id) AS question_count, COUNT(DISTINCT ep.id) AS paper_count
     FROM subjects sub
     LEFT JOIN question_bank qb ON qb.subject_id = sub.id AND qb.archived = 0
     LEFT JOIN exam_papers ep ON ep.subject_id = sub.id
     GROUP BY sub.id ORDER BY sub.name`
  ).all();

  await respondWithFormat(req, res, {
    title: 'Examination Summary',
    fileBase: 'exam-summary',
    columns: [
      { key: 'subject_name', label: 'Subject' }, { key: 'question_count', label: 'Questions in Bank' }, { key: 'paper_count', label: 'Papers Generated' }
    ],
    rows
  });
}));


// =================== Student reports ===================
const STUDENT_VIEW = requireAccessAny([['reports', 'view'], ['students', 'view']]);
const CURRENT = "s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')";

router.get('/student-strength', STUDENT_VIEW, asyncHandler(async (req, res) => {
  const rows = getDb().prepare(
    `SELECT c.name AS class_name, sec.name AS section_name, t.full_name AS class_teacher,
            SUM(CASE WHEN s.gender = 'Male' THEN 1 ELSE 0 END) AS boys,
            SUM(CASE WHEN s.gender = 'Female' THEN 1 ELSE 0 END) AS girls,
            COUNT(s.id) AS total, sec.capacity
     FROM sections sec JOIN classes c ON c.id = sec.class_id LEFT JOIN teachers t ON t.id = sec.class_teacher_id
     LEFT JOIN students s ON s.section_id = sec.id AND ${CURRENT}
     WHERE (@class_id = '' OR sec.class_id = @class_id)
     GROUP BY sec.id ORDER BY c.sort_order, c.name, sec.name`
  ).all({ class_id: req.query.class_id || '' });
  const tot = rows.reduce((a, r) => ({ boys: a.boys + r.boys, girls: a.girls + r.girls, total: a.total + r.total }), { boys: 0, girls: 0, total: 0 });
  rows.push({ class_name: 'TOTAL', section_name: '', class_teacher: '', ...tot, capacity: '' });
  await respondWithFormat(req, res, {
    title: 'Student Strength (class-wise)', fileBase: 'student-strength',
    columns: [{ key: 'class_name', label: 'Class' }, { key: 'section_name', label: 'Section' }, { key: 'class_teacher', label: 'Class Teacher' },
      { key: 'boys', label: 'Boys' }, { key: 'girls', label: 'Girls' }, { key: 'total', label: 'Total' }, { key: 'capacity', label: 'Capacity' }],
    rows
  });
}));

router.get('/student-directory', STUDENT_VIEW, asyncHandler(async (req, res) => {
  const { section_id = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT s.student_code, s.admission_number, s.full_name, c.name || ' - ' || sec.name AS class_name, s.roll_number, s.gender, s.date_of_birth,
            p.full_name AS parent_name, p.phone AS parent_phone, s.address
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE ${CURRENT} AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY c.sort_order, sec.name, s.roll_number, s.full_name`
  ).all({ section_id, class_id: req.query.class_id || '' });
  await respondWithFormat(req, res, {
    title: 'Student Directory', fileBase: 'student-directory',
    columns: [{ key: 'student_code', label: 'ID' }, { key: 'full_name', label: 'Student' }, { key: 'class_name', label: 'Class' }, { key: 'roll_number', label: 'Roll' },
      { key: 'gender', label: 'Gender' }, { key: 'date_of_birth', label: 'DOB' }, { key: 'parent_name', label: 'Parent' }, { key: 'parent_phone', label: 'Phone' }, { key: 'address', label: 'Address' }],
    rows
  });
}));

router.get('/student-admissions', STUDENT_VIEW, asyncHandler(async (req, res) => {
  const { from = '', to = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT s.admission_date, s.admission_number, s.full_name, c.name || ' - ' || sec.name AS class_name, s.gender, p.full_name AS parent_name, p.phone AS parent_phone
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE s.archived = 0 AND (@from = '' OR s.admission_date >= @from) AND (@to = '' OR s.admission_date <= @to)
       AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY s.admission_date DESC, s.full_name`
  ).all({ from, to, section_id: req.query.section_id || '', class_id: req.query.class_id || '' });
  await respondWithFormat(req, res, {
    title: 'New Admissions', fileBase: 'new-admissions',
    columns: [{ key: 'admission_date', label: 'Admitted' }, { key: 'admission_number', label: 'Adm No' }, { key: 'full_name', label: 'Student' }, { key: 'class_name', label: 'Class' },
      { key: 'gender', label: 'Gender' }, { key: 'parent_name', label: 'Parent' }, { key: 'parent_phone', label: 'Phone' }],
    rows
  });
}));

router.get('/students-left', STUDENT_VIEW, asyncHandler(async (req, res) => {
  const { from = '', to = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT s.left_on, s.full_name, s.admission_number, c.name || ' - ' || sec.name AS class_name, s.leaving_type, s.leaving_reason,
            (SELECT COALESCE(SUM(fi.total_amount + fi.fine_amount - fi.paid_amount), 0) FROM fee_invoices fi WHERE fi.student_id = s.id AND fi.status NOT IN ('Paid', 'Cancelled')) AS dues
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE s.archived = 0 AND s.status IN ('Left', 'Graduated') AND (@from = '' OR s.left_on >= @from) AND (@to = '' OR s.left_on <= @to)
       AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY s.left_on DESC`
  ).all({ from, to, section_id: req.query.section_id || '', class_id: req.query.class_id || '' });
  await respondWithFormat(req, res, {
    title: 'Students Who Left', fileBase: 'students-left',
    columns: [{ key: 'left_on', label: 'Left On' }, { key: 'full_name', label: 'Student' }, { key: 'admission_number', label: 'Adm No' }, { key: 'class_name', label: 'Class' },
      { key: 'leaving_type', label: 'Reason' }, { key: 'leaving_reason', label: 'Details' }, { key: 'dues', label: 'Dues Outstanding' }],
    rows
  });
}));

// =================== More attendance reports ===================
router.get('/staff-attendance-summary', requireAccessAny([['reports', 'manage'], ['attendance', 'manage'], ['staff', 'view']]), asyncHandler(async (req, res) => {
  const { from = '', to = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT st.full_name, sc.name AS category,
       SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
       SUM(CASE WHEN sa.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
       SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) AS late_days,
       SUM(CASE WHEN sa.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
       COUNT(sa.id) AS total_marked
     FROM staff st JOIN staff_categories sc ON sc.id = st.category_id
     LEFT JOIN staff_attendance sa ON sa.staff_id = st.id AND (@from = '' OR sa.attendance_date >= @from) AND (@to = '' OR sa.attendance_date <= @to)
     WHERE st.archived = 0 GROUP BY st.id ORDER BY st.full_name`
  ).all({ from, to });
  await respondWithFormat(req, res, {
    title: 'Non-Teaching Staff Attendance', fileBase: 'staff-attendance',
    columns: [{ key: 'full_name', label: 'Staff' }, { key: 'category', label: 'Category' }, { key: 'present_days', label: 'Present' }, { key: 'absent_days', label: 'Absent' },
      { key: 'late_days', label: 'Late' }, { key: 'leave_days', label: 'Leave' }, { key: 'total_marked', label: 'Total Marked' }],
    rows
  });
}));

router.get('/daily-absentees', requireAccess(['reports', 'attendance'], 'view'), asyncHandler(async (req, res) => {
  const date = req.query.date || localDateStr();
  const rows = getDb().prepare(
    `SELECT c.name || ' - ' || sec.name AS class_name, s.roll_number, s.full_name, sa.status, p.full_name AS parent_name, p.phone AS parent_phone, sa.remarks
     FROM student_attendance sa JOIN students s ON s.id = sa.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE sa.attendance_date = @date AND sa.status IN ('Absent', 'Leave', 'Late')
       AND (@section_id = '' OR s.section_id = @section_id) AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY c.sort_order, sec.name, s.roll_number`
  ).all({ date, section_id: req.query.section_id || '', class_id: req.query.class_id || '' });
  await respondWithFormat(req, res, {
    title: `Absent / Late / Leave — ${date}`, fileBase: `absentees-${date}`,
    columns: [{ key: 'class_name', label: 'Class' }, { key: 'roll_number', label: 'Roll' }, { key: 'full_name', label: 'Student' }, { key: 'status', label: 'Status' },
      { key: 'parent_name', label: 'Parent' }, { key: 'parent_phone', label: 'Phone' }, { key: 'remarks', label: 'Remarks' }],
    rows
  });
}));

// =================== More financial reports ===================
const FINANCE_VIEW = requireAccessAny([['reports', 'manage'], ['fees', 'view'], ['expenses', 'view'], ['accounts', 'view']]);

router.get('/fee-defaulters', requireAccessAny([['reports', 'manage'], ['fees', 'view']]), asyncHandler(async (req, res) => {
  const { section_id = '' } = req.query;
  const today = localDateStr();
  const rows = getDb().prepare(
    `SELECT s.full_name, c.name || ' - ' || sec.name AS class_name, p.full_name AS parent_name, p.phone AS parent_phone,
            COUNT(fi.id) AS invoices, MIN(fi.due_date) AS oldest_due,
            ROUND(SUM(fi.total_amount + fi.fine_amount - fi.paid_amount), 2) AS balance
     FROM fee_invoices fi JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE fi.status NOT IN ('Paid', 'Cancelled') AND fi.due_date < @today AND (@section_id = '' OR s.section_id = @section_id)
       AND (@class_id = '' OR sec.class_id = @class_id)
     GROUP BY s.id HAVING balance > 0 ORDER BY balance DESC`
  ).all({ today, section_id, class_id: req.query.class_id || '' });
  await respondWithFormat(req, res, {
    title: 'Fee Defaulters (overdue)', fileBase: 'fee-defaulters',
    columns: [{ key: 'full_name', label: 'Student' }, { key: 'class_name', label: 'Class' }, { key: 'parent_name', label: 'Parent' }, { key: 'parent_phone', label: 'Phone' },
      { key: 'invoices', label: 'Unpaid Invoices' }, { key: 'oldest_due', label: 'Oldest Due' }, { key: 'balance', label: 'Balance' }],
    rows
  });
}));

router.get('/expense-by-category', FINANCE_VIEW, asyncHandler(async (req, res) => {
  const { from = '', to = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT ec.name AS category, COUNT(e.id) AS entries, ROUND(SUM(e.amount), 2) AS amount
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.deleted_at IS NULL AND (@from = '' OR e.expense_date >= @from) AND (@to = '' OR e.expense_date <= @to)
     GROUP BY ec.id ORDER BY amount DESC`
  ).all({ from, to });
  await respondWithFormat(req, res, {
    title: 'Expenses by Category', fileBase: 'expenses-by-category',
    columns: [{ key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries' }, { key: 'amount', label: 'Amount' }],
    rows
  });
}));

router.get('/transport-fees', requireAccessAny([['reports', 'manage'], ['transport', 'view'], ['fees', 'view']]), asyncHandler(async (req, res) => {
  const rows = getDb().prepare(
    `SELECT r.name AS route_name, v.vehicle_no, COUNT(st.id) AS students, ROUND(SUM(COALESCE(st.monthly_fee, r.monthly_fee)), 2) AS monthly_total
     FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id
     LEFT JOIN student_transport st ON st.route_id = r.id AND (st.end_date IS NULL OR st.end_date >= date('now', 'localtime'))
     WHERE r.archived = 0 GROUP BY r.id ORDER BY r.name`
  ).all();
  await respondWithFormat(req, res, {
    title: 'Transport Routes & Monthly Fees', fileBase: 'transport-fees',
    columns: [{ key: 'route_name', label: 'Route' }, { key: 'vehicle_no', label: 'Vehicle' }, { key: 'students', label: 'Students' }, { key: 'monthly_total', label: 'Monthly Total' }],
    rows
  });
}));

// =================== Academic reports ===================
const ACADEMIC_VIEW = requireAccessAny([['reports', 'view'], ['results', 'view'], ['homework', 'view']]);

router.get('/result-summary', ACADEMIC_VIEW, asyncHandler(async (req, res) => {
  const db = getDb();
  const { term_id = '' } = req.query;
  const R = require('../services/results');
  const pairs = db.prepare(
    `SELECT DISTINCT a.term_id, a.section_id FROM assessments a WHERE a.archived = 0 AND a.term_id IS NOT NULL AND (@term_id = '' OR a.term_id = @term_id)`
  ).all({ term_id });
  const rows = pairs.map((p) => {
    const d = R.termResults(db, p.term_id, p.section_id);
    const pcts = d.students.filter((s) => s.percentage !== null).map((s) => s.percentage);
    const top = [...d.students].filter((s) => s.position === 1).map((s) => s.full_name).join(', ');
    return {
      term: d.term.name, class_name: `${d.section.class_name} - ${d.section.section_name}`, students: d.stats.students,
      passed: d.stats.passed, failed: d.stats.failed, pass_rate: d.stats.students ? `${Math.round((d.stats.passed / d.stats.students) * 1000) / 10}%` : '-',
      average: pcts.length ? `${Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10}%` : '-',
      topper: top || '-', approved: d.approval ? 'Yes' : 'No'
    };
  });
  await respondWithFormat(req, res, {
    title: 'Result Summary', fileBase: 'result-summary',
    columns: [{ key: 'term', label: 'Exam' }, { key: 'class_name', label: 'Class' }, { key: 'students', label: 'Students' }, { key: 'passed', label: 'Passed' },
      { key: 'failed', label: 'Failed' }, { key: 'pass_rate', label: 'Pass %' }, { key: 'average', label: 'Class Average' }, { key: 'topper', label: 'Position 1' }, { key: 'approved', label: 'Approved' }],
    rows
  });
}));

router.get('/subject-averages', ACADEMIC_VIEW, asyncHandler(async (req, res) => {
  const { from = '', to = '', section_id = '' } = req.query;
  const rows = getDb().prepare(
    `SELECT c.name || ' - ' || sec.name AS class_name, sub.name AS subject_name, COUNT(DISTINCT a.id) AS tests,
            ROUND(AVG(am.obtained * 100.0 / a.total_marks), 1) AS average_percent,
            ROUND(MAX(am.obtained * 100.0 / a.total_marks), 1) AS highest, ROUND(MIN(am.obtained * 100.0 / a.total_marks), 1) AS lowest
     FROM assessments a JOIN assessment_marks am ON am.assessment_id = a.id AND am.obtained IS NOT NULL AND am.absent = 0
     JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id JOIN subjects sub ON sub.id = a.subject_id
     WHERE a.archived = 0 AND (@from = '' OR a.held_on >= @from) AND (@to = '' OR a.held_on <= @to) AND (@section_id = '' OR a.section_id = @section_id)
     GROUP BY a.section_id, a.subject_id ORDER BY c.sort_order, sec.name, sub.name`
  ).all({ from, to, section_id });
  await respondWithFormat(req, res, {
    title: 'Subject Averages', fileBase: 'subject-averages',
    columns: [{ key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' }, { key: 'tests', label: 'Tests' },
      { key: 'average_percent', label: 'Average %' }, { key: 'highest', label: 'Highest %' }, { key: 'lowest', label: 'Lowest %' }],
    rows
  });
}));

router.get('/syllabus-coverage', ACADEMIC_VIEW, asyncHandler(async (req, res) => {
  const rows = getDb().prepare(
    `SELECT c.name AS class_name, sub.name AS subject_name, COUNT(*) AS topics,
            SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            ROUND(SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS percent_done,
            SUM(CASE WHEN t.status <> 'Completed' AND t.planned_to IS NOT NULL AND t.planned_to < @today THEN 1 ELSE 0 END) AS behind_schedule
     FROM syllabus_topics t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
     WHERE t.archived = 0 GROUP BY t.class_id, t.subject_id ORDER BY c.sort_order, sub.name`
  ).all({ today: localDateStr() });
  await respondWithFormat(req, res, {
    title: 'Syllabus Coverage', fileBase: 'syllabus-coverage',
    columns: [{ key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' }, { key: 'topics', label: 'Topics' }, { key: 'completed', label: 'Completed' },
      { key: 'percent_done', label: '% Done' }, { key: 'behind_schedule', label: 'Behind Schedule' }],
    rows
  });
}));

router.get('/library-overdue', requireAccessAny([['reports', 'view'], ['library', 'view']]), asyncHandler(async (req, res) => {
  const rows = getDb().prepare(
    `SELECT b.title, b.accession_no, i.borrower_name, i.issued_on, i.due_on, CAST(julianday(@today) - julianday(i.due_on) AS INTEGER) AS days_late
     FROM library_issues i JOIN library_books b ON b.id = i.book_id WHERE i.returned_on IS NULL AND i.due_on < @today ORDER BY i.due_on`
  ).all({ today: localDateStr() });
  await respondWithFormat(req, res, {
    title: 'Library — Overdue Books', fileBase: 'library-overdue',
    columns: [{ key: 'title', label: 'Book' }, { key: 'accession_no', label: 'Acc No' }, { key: 'borrower_name', label: 'Borrower' }, { key: 'issued_on', label: 'Issued' }, { key: 'due_on', label: 'Due' }, { key: 'days_late', label: 'Days Late' }],
    rows
  });
}));

router.get('/inventory-stock', requireAccessAny([['reports', 'manage'], ['inventory', 'view']]), asyncHandler(async (req, res) => {
  const rows = getDb().prepare(
    `SELECT name, category, location, quantity, unit, min_quantity, ROUND(quantity * COALESCE(unit_cost, 0), 2) AS stock_value,
            CASE WHEN quantity <= min_quantity AND min_quantity > 0 THEN 'LOW' ELSE '' END AS alert
     FROM inventory_items WHERE archived = 0 ORDER BY category, name`
  ).all();
  await respondWithFormat(req, res, {
    title: 'Inventory Stock', fileBase: 'inventory-stock',
    columns: [{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'location', label: 'Location' }, { key: 'quantity', label: 'Qty' },
      { key: 'unit', label: 'Unit' }, { key: 'min_quantity', label: 'Min' }, { key: 'stock_value', label: 'Value' }, { key: 'alert', label: 'Alert' }],
    rows
  });
}));

module.exports = router;
