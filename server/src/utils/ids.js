// Sequential, human-readable code/number generators backed by a `sequences`
// table with an atomic increment — O(1) regardless of how large the target
// table has grown, unlike a `SELECT COUNT(*)` (which would rescan the whole
// table on every single call, turning bulk operations like "generate 500
// invoices" into O(n^2)).
//
// Semantics are unchanged from the original COUNT(*)-based version: each
// sequence is a single running counter (not reset per year) — the year in
// the prefix is just a label, matching existing issued codes exactly.

function nextSequenceValue(db, sequenceName) {
  db.prepare(
    `INSERT INTO sequences (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`
  ).run(sequenceName);
  return db.prepare('SELECT value FROM sequences WHERE name = ?').get(sequenceName).value;
}

function formatted(db, sequenceName, prefix, pad) {
  const value = nextSequenceValue(db, sequenceName);
  return `${prefix}${String(value).padStart(pad, '0')}`;
}

function studentCode(db, year = new Date().getFullYear()) {
  return formatted(db, 'students.student_code', `STU${year}-`, 4);
}

function admissionNumber(db, year = new Date().getFullYear()) {
  return formatted(db, 'students.admission_number', `ADM${year}`, 5);
}

function teacherCode(db) {
  return formatted(db, 'teachers.teacher_code', 'EMP', 4);
}

function staffCode(db) {
  return formatted(db, 'staff.staff_code', 'STF', 4);
}

function invoiceNumber(db, year = new Date().getFullYear()) {
  return formatted(db, 'fee_invoices.invoice_number', `INV${year}-`, 5);
}

function receiptNumber(db, year = new Date().getFullYear()) {
  return formatted(db, 'fee_payments.receipt_number', `RCPT${year}-`, 5);
}

function payslipNumber(db, year, month) {
  return formatted(db, 'payroll_runs.payslip_number', `PS${year}${String(month).padStart(2, '0')}-`, 4);
}

function staffPayslipNumber(db, year, month) {
  return formatted(db, 'staff_payroll_runs.payslip_number', `SPS${year}${String(month).padStart(2, '0')}-`, 4);
}

function expenseNumber(db, year = new Date().getFullYear()) {
  return formatted(db, 'expenses.expense_number', `EXP${year}-`, 5);
}

module.exports = {
  studentCode, admissionNumber, teacherCode, staffCode, invoiceNumber, receiptNumber,
  payslipNumber, staffPayslipNumber, expenseNumber
};
