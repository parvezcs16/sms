const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const ids = require('../utils/ids');
const pdfService = require('../services/pdf');
const { getBranding } = require('../services/settings');
const notificationService = require('../services/notifications/notificationService');
const { runInTransaction } = require('../utils/tx');
const { userDesignation, localDateTimeStr, PAYMENT_MODES } = require('../utils/people');

const router = express.Router();
router.use(requireAuth);
const ACCOUNTS = [...ROLE_GROUPS.staffAdmin];

router.get('/structures/:teacherId', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const row = getDb().prepare('SELECT * FROM payroll_structures WHERE teacher_id = ?').get(req.params.teacherId);
  res.json(row || null);
}));

router.post('/structures', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { teacher_id, basic_salary, allowances, deductions, effective_from } = req.body;
  if (!teacher_id || basic_salary === undefined) throw new HttpError(400, 'teacher_id and basic_salary are required');
  getDb().prepare(
    `INSERT INTO payroll_structures (teacher_id, basic_salary, allowances_json, deductions_json, effective_from)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')))
     ON CONFLICT(teacher_id) DO UPDATE SET basic_salary = excluded.basic_salary, allowances_json = excluded.allowances_json,
       deductions_json = excluded.deductions_json, effective_from = excluded.effective_from`
  ).run(teacher_id, basic_salary, JSON.stringify(allowances || []), JSON.stringify(deductions || []), effective_from || null);
  recordAudit(req, 'upsert', 'payroll_structure', Number(teacher_id));
  res.json({ success: true });
}));

// ---- Salary advances / loan recovery ----
router.get('/advances', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const { teacher_id = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT sa.*, t.full_name AS teacher_name FROM salary_advances sa JOIN teachers t ON t.id = sa.teacher_id
     WHERE (@teacher_id = '' OR sa.teacher_id = @teacher_id) ORDER BY sa.taken_on DESC`
  ).all({ teacher_id }));
}));

router.post('/advances', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { teacher_id, amount, reason, recovery_per_month } = req.body;
  if (!teacher_id || !amount || !recovery_per_month) throw new HttpError(400, 'teacher_id, amount and recovery_per_month are required');
  const result = getDb().prepare(
    `INSERT INTO salary_advances (teacher_id, amount, reason, recovery_per_month, remaining_balance) VALUES (?, ?, ?, ?, ?)`
  ).run(teacher_id, amount, reason || null, recovery_per_month, amount);
  recordAudit(req, 'create', 'salary_advance', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

// ---- Payroll run ----
function runPayrollForTeacher(db, teacherId, month, year) {
  const structure = db.prepare('SELECT * FROM payroll_structures WHERE teacher_id = ?').get(teacherId);
  if (!structure) return { skipped: true, reason: 'No salary structure defined' };

  const existing = db.prepare('SELECT id FROM payroll_runs WHERE teacher_id = ? AND month = ? AND year = ?').get(teacherId, month, year);
  if (existing) return { skipped: true, reason: 'Already generated for this period' };

  const allowances = JSON.parse(structure.allowances_json || '[]');
  const deductions = JSON.parse(structure.deductions_json || '[]');
  const totalAllowances = allowances.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const activeAdvances = db.prepare(
    `SELECT * FROM salary_advances WHERE teacher_id = ? AND status = 'Active' AND remaining_balance > 0`
  ).all(teacherId);
  let advanceDeduction = 0;
  for (const advance of activeAdvances) {
    advanceDeduction += Math.min(advance.recovery_per_month, advance.remaining_balance);
  }

  const netSalary = structure.basic_salary + totalAllowances - totalDeductions - advanceDeduction;
  const payslipNo = ids.payslipNumber(db, year, month);

  const result = db.prepare(
    `INSERT INTO payroll_runs (teacher_id, month, year, basic, total_allowances, total_deductions, advance_deduction, net_salary, payslip_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(teacherId, month, year, structure.basic_salary, totalAllowances, totalDeductions, advanceDeduction, netSalary, payslipNo);

  if (advanceDeduction > 0) {
    let remaining = advanceDeduction;
    for (const advance of activeAdvances) {
      if (remaining <= 0) break;
      const applied = Math.min(advance.recovery_per_month, advance.remaining_balance, remaining);
      const newBalance = advance.remaining_balance - applied;
      db.prepare('UPDATE salary_advances SET remaining_balance = ?, status = ? WHERE id = ?')
        .run(newBalance, newBalance <= 0 ? 'Cleared' : 'Active', advance.id);
      remaining -= applied;
    }
  }

  return { skipped: false, id: Number(result.lastInsertRowid), payslip_number: payslipNo, net_salary: netSalary };
}

router.post('/run', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { teacher_id, month, year } = req.body;
  if (!teacher_id || !month || !year) throw new HttpError(400, 'teacher_id, month and year are required');
  const db = getDb();
  const result = runPayrollForTeacher(db, teacher_id, month, year);
  if (result.skipped) throw new HttpError(400, result.reason);
  recordAudit(req, 'run_payroll', 'teacher', Number(teacher_id), { month, year });
  res.status(201).json(result);
}));

router.post('/run-bulk', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) throw new HttpError(400, 'month and year are required');
  const db = getDb();
  const teachers = db.prepare('SELECT id FROM teachers WHERE archived = 0 AND status = ?').all('Active');
  const results = teachers.map((t) => ({ teacher_id: t.id, ...runPayrollForTeacher(db, t.id, month, year) }));
  const generated = results.filter((r) => !r.skipped).length;
  recordAudit(req, 'run_payroll_bulk', 'teacher', null, { month, year, generated });
  res.json({ generated, results });
}));

router.get('/runs', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { teacher_id = '', month = '', year = '' } = req.query;
  res.json(db.prepare(
    `SELECT pr.*, t.full_name AS teacher_name, t.teacher_code FROM payroll_runs pr JOIN teachers t ON t.id = pr.teacher_id
     WHERE (@teacher_id = '' OR pr.teacher_id = @teacher_id) AND (@month = '' OR pr.month = @month) AND (@year = '' OR pr.year = @year)
     ORDER BY pr.year DESC, pr.month DESC`
  ).all({ teacher_id, month, year }));
}));

async function buildPayslipPdf(db, runId) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(run.teacher_id);
  const structure = db.prepare('SELECT * FROM payroll_structures WHERE teacher_id = ?').get(run.teacher_id);
  const { schoolName, logoPath, stampPath } = getBranding(db, 'payslips');
  const buffer = await pdfService.payslipPdf({
    schoolName,
    logoPath,
    stampPath,
    teacher: { ...teacher, allowances_json: structure?.allowances_json, deductions_json: structure?.deductions_json },
    run
  });
  return { run, teacher, buffer };
}

router.get('/runs/:id/payslip.pdf', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const data = await buildPayslipPdf(getDb(), req.params.id);
  if (!data) throw new HttpError(404, 'Payroll run not found');
  pdfService.sendPdf(res, `payslip-${data.run.payslip_number}.pdf`, data.buffer);
}));

router.post('/runs/:id/send-payslip', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const data = await buildPayslipPdf(db, req.params.id);
  if (!data) throw new HttpError(404, 'Payroll run not found');
  if (!data.teacher.email && !data.teacher.phone) throw new HttpError(400, 'This teacher has no email or phone on file');
  const result = await notificationService.sendNotification({
    title: 'Salary Payslip',
    message: `Dear ${data.teacher.full_name}, your payslip for ${data.run.month}/${data.run.year} is attached. Net salary: ${data.run.net_salary.toFixed(2)}.`,
    category: 'Announcement',
    audienceType: 'Individual',
    audienceRef: JSON.stringify([{ name: data.teacher.full_name, email: data.teacher.email, phone: data.teacher.phone }]),
    channels: ['email', 'whatsapp'],
    createdBy: req.user.id,
    attachment: { buffer: data.buffer, fileName: `payslip-${data.run.payslip_number}.pdf`, mimetype: 'application/pdf' }
  });
  recordAudit(req, 'send_payslip', 'payroll_run', Number(req.params.id));
  res.json(result);
}));

// =====================================================================
// Non-teaching staff payroll — deliberately mirrors the teacher payroll
// functions above 1:1 (same computation, same advance-recovery logic) rather
// than sharing code, so the already-tested teacher payroll path can't be
// affected by staff-specific changes. Lives in the same Payroll page on the
// frontend via an employee-type switch, not a separate section.
// =====================================================================

router.get('/staff/structures/:staffId', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const row = getDb().prepare('SELECT * FROM staff_payroll_structures WHERE staff_id = ?').get(req.params.staffId);
  res.json(row || null);
}));

router.post('/staff/structures', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { staff_id, basic_salary, allowances, deductions, effective_from } = req.body;
  if (!staff_id || basic_salary === undefined) throw new HttpError(400, 'staff_id and basic_salary are required');
  getDb().prepare(
    `INSERT INTO staff_payroll_structures (staff_id, basic_salary, allowances_json, deductions_json, effective_from)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')))
     ON CONFLICT(staff_id) DO UPDATE SET basic_salary = excluded.basic_salary, allowances_json = excluded.allowances_json,
       deductions_json = excluded.deductions_json, effective_from = excluded.effective_from`
  ).run(staff_id, basic_salary, JSON.stringify(allowances || []), JSON.stringify(deductions || []), effective_from || null);
  recordAudit(req, 'upsert', 'staff_payroll_structure', Number(staff_id));
  res.json({ success: true });
}));

router.get('/staff/advances', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const { staff_id = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT sa.*, st.full_name AS staff_name FROM staff_salary_advances sa JOIN staff st ON st.id = sa.staff_id
     WHERE (@staff_id = '' OR sa.staff_id = @staff_id) ORDER BY sa.taken_on DESC`
  ).all({ staff_id }));
}));

router.post('/staff/advances', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { staff_id, amount, reason, recovery_per_month } = req.body;
  if (!staff_id || !amount || !recovery_per_month) throw new HttpError(400, 'staff_id, amount and recovery_per_month are required');
  const result = getDb().prepare(
    `INSERT INTO staff_salary_advances (staff_id, amount, reason, recovery_per_month, remaining_balance) VALUES (?, ?, ?, ?, ?)`
  ).run(staff_id, amount, reason || null, recovery_per_month, amount);
  recordAudit(req, 'create', 'staff_salary_advance', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

function runPayrollForStaff(db, staffId, month, year) {
  const structure = db.prepare('SELECT * FROM staff_payroll_structures WHERE staff_id = ?').get(staffId);
  if (!structure) return { skipped: true, reason: 'No salary structure defined' };

  const existing = db.prepare('SELECT id FROM staff_payroll_runs WHERE staff_id = ? AND month = ? AND year = ?').get(staffId, month, year);
  if (existing) return { skipped: true, reason: 'Already generated for this period' };

  const allowances = JSON.parse(structure.allowances_json || '[]');
  const deductions = JSON.parse(structure.deductions_json || '[]');
  const totalAllowances = allowances.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const activeAdvances = db.prepare(
    `SELECT * FROM staff_salary_advances WHERE staff_id = ? AND status = 'Active' AND remaining_balance > 0`
  ).all(staffId);
  let advanceDeduction = 0;
  for (const advance of activeAdvances) {
    advanceDeduction += Math.min(advance.recovery_per_month, advance.remaining_balance);
  }

  const netSalary = structure.basic_salary + totalAllowances - totalDeductions - advanceDeduction;
  const payslipNo = ids.staffPayslipNumber(db, year, month);

  const result = db.prepare(
    `INSERT INTO staff_payroll_runs (staff_id, month, year, basic, total_allowances, total_deductions, advance_deduction, net_salary, payslip_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(staffId, month, year, structure.basic_salary, totalAllowances, totalDeductions, advanceDeduction, netSalary, payslipNo);

  if (advanceDeduction > 0) {
    let remaining = advanceDeduction;
    for (const advance of activeAdvances) {
      if (remaining <= 0) break;
      const applied = Math.min(advance.recovery_per_month, advance.remaining_balance, remaining);
      const newBalance = advance.remaining_balance - applied;
      db.prepare('UPDATE staff_salary_advances SET remaining_balance = ?, status = ? WHERE id = ?')
        .run(newBalance, newBalance <= 0 ? 'Cleared' : 'Active', advance.id);
      remaining -= applied;
    }
  }

  return { skipped: false, id: Number(result.lastInsertRowid), payslip_number: payslipNo, net_salary: netSalary };
}

router.post('/staff/run', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { staff_id, month, year } = req.body;
  if (!staff_id || !month || !year) throw new HttpError(400, 'staff_id, month and year are required');
  const db = getDb();
  const result = runPayrollForStaff(db, staff_id, month, year);
  if (result.skipped) throw new HttpError(400, result.reason);
  recordAudit(req, 'run_payroll', 'staff', Number(staff_id), { month, year });
  res.status(201).json(result);
}));

router.post('/staff/run-bulk', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) throw new HttpError(400, 'month and year are required');
  const db = getDb();
  const staffMembers = db.prepare(`SELECT id FROM staff WHERE archived = 0 AND status = 'Active'`).all();
  const results = staffMembers.map((s) => ({ staff_id: s.id, ...runPayrollForStaff(db, s.id, month, year) }));
  const generated = results.filter((r) => !r.skipped).length;
  recordAudit(req, 'run_payroll_bulk', 'staff', null, { month, year, generated });
  res.json({ generated, results });
}));

router.get('/staff/runs', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { staff_id = '', month = '', year = '' } = req.query;
  res.json(db.prepare(
    `SELECT pr.*, st.full_name AS staff_name, st.staff_code FROM staff_payroll_runs pr JOIN staff st ON st.id = pr.staff_id
     WHERE (@staff_id = '' OR pr.staff_id = @staff_id) AND (@month = '' OR pr.month = @month) AND (@year = '' OR pr.year = @year)
     ORDER BY pr.year DESC, pr.month DESC`
  ).all({ staff_id, month, year }));
}));

async function buildStaffPayslipPdf(db, runId) {
  const run = db.prepare('SELECT * FROM staff_payroll_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const staffMember = db.prepare(
    `SELECT st.*, sc.name AS category_name FROM staff st JOIN staff_categories sc ON sc.id = st.category_id WHERE st.id = ?`
  ).get(run.staff_id);
  const structure = db.prepare('SELECT * FROM staff_payroll_structures WHERE staff_id = ?').get(run.staff_id);
  const { schoolName, logoPath, stampPath } = getBranding(db, 'payslips');
  const buffer = await pdfService.payslipPdf({
    schoolName,
    logoPath,
    stampPath,
    teacher: {
      full_name: staffMember.full_name,
      teacher_code: staffMember.staff_code,
      designation: staffMember.category_name,
      allowances_json: structure?.allowances_json,
      deductions_json: structure?.deductions_json
    },
    run
  });
  return { run, staff: staffMember, buffer };
}

router.get('/staff/runs/:id/payslip.pdf', requireAccess('payroll', 'view'), asyncHandler(async (req, res) => {
  const data = await buildStaffPayslipPdf(getDb(), req.params.id);
  if (!data) throw new HttpError(404, 'Payroll run not found');
  pdfService.sendPdf(res, `payslip-${data.run.payslip_number}.pdf`, data.buffer);
}));

router.post('/staff/runs/:id/send-payslip', requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const data = await buildStaffPayslipPdf(db, req.params.id);
  if (!data) throw new HttpError(404, 'Payroll run not found');
  if (!data.staff.email && !data.staff.phone) throw new HttpError(400, 'This staff member has no email or phone on file');
  const result = await notificationService.sendNotification({
    title: 'Salary Payslip',
    message: `Dear ${data.staff.full_name}, your payslip for ${data.run.month}/${data.run.year} is attached. Net salary: ${data.run.net_salary.toFixed(2)}.`,
    category: 'Announcement',
    audienceType: 'Individual',
    audienceRef: JSON.stringify([{ name: data.staff.full_name, email: data.staff.email, phone: data.staff.phone }]),
    channels: ['email', 'whatsapp'],
    createdBy: req.user.id,
    attachment: { buffer: data.buffer, fileName: `payslip-${data.run.payslip_number}.pdf`, mimetype: 'application/pdf' }
  });
  recordAudit(req, 'send_payslip', 'staff_payroll_run', Number(req.params.id));
  res.json(result);
}));

// =====================================================================
// Corrections for payroll (teachers and non-teaching staff share these
// handlers via a small table map). A payslip can be edited or deleted only
// while it is still unpaid; "Mark Unpaid" undoes an accidental "Mark Paid".
// =====================================================================
const KINDS = {
  teacher: { runs: 'payroll_runs', advances: 'salary_advances', person: 'teacher_id', entity: 'payroll_run' },
  staff: { runs: 'staff_payroll_runs', advances: 'staff_salary_advances', person: 'staff_id', entity: 'staff_payroll_run' }
};
const money = (v) => Math.round(Number(v) * 100) / 100;

function registerCorrections(prefix, kind) {
  const k = KINDS[kind];

  router.put(`${prefix}/runs/:id`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    if (run.status === 'Paid') throw new HttpError(400, 'This payslip is already marked Paid — mark it unpaid first to edit it');
    const next = {
      basic: req.body.basic === undefined ? run.basic : money(req.body.basic),
      total_allowances: req.body.total_allowances === undefined ? run.total_allowances : money(req.body.total_allowances),
      total_deductions: req.body.total_deductions === undefined ? run.total_deductions : money(req.body.total_deductions)
    };
    if (Object.values(next).some((v) => Number.isNaN(v) || v < 0)) throw new HttpError(400, 'Amounts must be 0 or more');
    const net = money(next.basic + next.total_allowances - next.total_deductions - run.advance_deduction);
    db.prepare(
      `UPDATE ${k.runs} SET basic = ?, total_allowances = ?, total_deductions = ?, net_salary = ?, remarks = ?,
         approved_by = CASE WHEN net_salary = ? THEN approved_by END,
         approved_by_name = CASE WHEN net_salary = ? THEN approved_by_name END,
         approved_by_designation = CASE WHEN net_salary = ? THEN approved_by_designation END,
         approved_at = CASE WHEN net_salary = ? THEN approved_at END
       WHERE id = ?`
    ).run(next.basic, next.total_allowances, next.total_deductions, net,
      req.body.remarks === undefined ? run.remarks : (req.body.remarks || null), net, net, net, net, run.id);
    recordAudit(req, 'edit_payslip', k.entity, run.id, { before: { basic: run.basic, total_allowances: run.total_allowances, total_deductions: run.total_deductions, net_salary: run.net_salary }, after: { ...next, net_salary: net } });
    res.json({ success: true, net_salary: net });
  }));

  // Paying a salary records how it was paid, who paid it and exactly when
  // (server clock). The payer's name is printed on the payslip in place of a
  // handwritten signature.
  router.put(`${prefix}/runs/:id/mark-paid`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    if (run.status === 'Paid') throw new HttpError(400, 'This salary is already marked Paid');
    const mode = String(req.body.payment_mode || 'Cash').trim();
    if (!PAYMENT_MODES.includes(mode)) throw new HttpError(400, `Payment mode must be one of: ${PAYMENT_MODES.join(', ')}`);
    const reference = String(req.body.payment_reference || '').trim() || null;
    if (mode === 'Cheque' && !reference) throw new HttpError(400, 'Please enter the cheque number');
    const who = userDesignation(db, req.user.id);
    const paidAt = localDateTimeStr();
    db.prepare(
      `UPDATE ${k.runs} SET status = 'Paid', paid_at = ?, payment_mode = ?, payment_reference = ?, paid_by = ?, paid_by_name = ? WHERE id = ?`
    ).run(paidAt, mode, reference, req.user.id, who.name, run.id);
    recordAudit(req, 'mark_paid', k.entity, run.id, { payslip_number: run.payslip_number, net_salary: run.net_salary, payment_mode: mode, payment_reference: reference, paid_at: paidAt });
    res.json({ success: true, paid_at: paidAt, paid_by_name: who.name, payment_mode: mode });
  }));

  router.put(`${prefix}/runs/:id/mark-unpaid`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    db.prepare(`UPDATE ${k.runs} SET status = 'Pending', paid_at = NULL, payment_mode = NULL, payment_reference = NULL, paid_by = NULL, paid_by_name = NULL WHERE id = ?`).run(run.id);
    recordAudit(req, 'mark_unpaid', k.entity, run.id, { was: { paid_at: run.paid_at, payment_mode: run.payment_mode, paid_by_name: run.paid_by_name } });
    res.json({ success: true });
  }));

  // Approval / verification by management (Principal, Admin, Super Admin):
  // stores the approver's name, designation and the exact time.
  router.put(`${prefix}/runs/:id/approve`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    if (!isManagement(req.user)) throw new HttpError(403, 'Only the Principal, Admin or Super Admin can approve salary payments');
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    const who = userDesignation(db, req.user.id);
    const at = localDateTimeStr();
    db.prepare(`UPDATE ${k.runs} SET approved_by = ?, approved_by_name = ?, approved_by_designation = ?, approved_at = ? WHERE id = ?`)
      .run(req.user.id, who.name, who.designation, at, run.id);
    recordAudit(req, 'approve_salary', k.entity, run.id, { payslip_number: run.payslip_number, net_salary: run.net_salary, approved_at: at });
    res.json({ success: true, approved_by_name: who.name, approved_by_designation: who.designation, approved_at: at });
  }));

  router.put(`${prefix}/runs/:id/unapprove`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    if (!isManagement(req.user)) throw new HttpError(403, 'Only the Principal, Admin or Super Admin can change an approval');
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    db.prepare(`UPDATE ${k.runs} SET approved_by = NULL, approved_by_name = NULL, approved_by_designation = NULL, approved_at = NULL WHERE id = ?`).run(run.id);
    recordAudit(req, 'unapprove_salary', k.entity, run.id, { was: { approved_by_name: run.approved_by_name, approved_at: run.approved_at } });
    res.json({ success: true });
  }));

  // Deleting an unpaid payslip gives back whatever it recovered from salary
  // advances, so the payslip can simply be generated again correctly.
  router.delete(`${prefix}/runs/:id`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const run = db.prepare(`SELECT * FROM ${k.runs} WHERE id = ?`).get(req.params.id);
    if (!run) throw new HttpError(404, 'Payslip not found');
    if (run.status === 'Paid') throw new HttpError(400, 'This payslip is marked Paid — mark it unpaid first if it really should be removed');
    runInTransaction(db, () => {
      let toRestore = run.advance_deduction || 0;
      if (toRestore > 0) {
        const advances = db.prepare(
          `SELECT * FROM ${k.advances} WHERE ${k.person} = ? AND remaining_balance < amount ORDER BY taken_on DESC, id DESC`
        ).all(run[k.person]);
        for (const adv of advances) {
          if (toRestore <= 0) break;
          const room = adv.amount - adv.remaining_balance;
          const give = Math.min(room, toRestore);
          db.prepare(`UPDATE ${k.advances} SET remaining_balance = ?, status = 'Active' WHERE id = ?`).run(money(adv.remaining_balance + give), adv.id);
          toRestore -= give;
        }
      }
      db.prepare(`DELETE FROM ${k.runs} WHERE id = ?`).run(run.id);
    });
    recordAudit(req, 'delete_payslip', k.entity, run.id, { payslip_number: run.payslip_number, month: run.month, year: run.year, net_salary: run.net_salary });
    res.json({ success: true });
  }));

  router.put(`${prefix}/advances/:id`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const adv = db.prepare(`SELECT * FROM ${k.advances} WHERE id = ?`).get(req.params.id);
    if (!adv) throw new HttpError(404, 'Advance not found');
    const recovered = money(adv.amount - adv.remaining_balance);
    const amount = req.body.amount === undefined ? adv.amount : money(req.body.amount);
    const perMonth = req.body.recovery_per_month === undefined ? adv.recovery_per_month : money(req.body.recovery_per_month);
    if (!(amount > 0) || !(perMonth > 0)) throw new HttpError(400, 'Amount and monthly recovery must be more than 0');
    if (amount < recovered) throw new HttpError(400, `${recovered.toFixed(2)} has already been recovered — the amount can't be less than that`);
    const remaining = money(amount - recovered);
    db.prepare(`UPDATE ${k.advances} SET amount = ?, recovery_per_month = ?, remaining_balance = ?, reason = ?, status = ? WHERE id = ?`)
      .run(amount, perMonth, remaining, req.body.reason === undefined ? adv.reason : (req.body.reason || null), remaining <= 0 ? 'Cleared' : 'Active', adv.id);
    recordAudit(req, 'edit_advance', k.advances, adv.id, { before: { amount: adv.amount, recovery_per_month: adv.recovery_per_month }, after: { amount, recovery_per_month: perMonth } });
    res.json({ success: true });
  }));

  router.delete(`${prefix}/advances/:id`, requireAccess('payroll', 'manage'), asyncHandler(async (req, res) => {
    const db = getDb();
    const adv = db.prepare(`SELECT * FROM ${k.advances} WHERE id = ?`).get(req.params.id);
    if (!adv) throw new HttpError(404, 'Advance not found');
    if (adv.remaining_balance < adv.amount) throw new HttpError(400, 'Part of this advance has already been recovered through payroll — edit it instead of deleting');
    db.prepare(`DELETE FROM ${k.advances} WHERE id = ?`).run(adv.id);
    recordAudit(req, 'delete_advance', k.advances, adv.id, { amount: adv.amount });
    res.json({ success: true });
  }));
}

registerCorrections('', 'teacher');
registerCorrections('/staff', 'staff');

module.exports = router;
