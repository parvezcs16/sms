const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const ids = require('../utils/ids');
const pdfService = require('../services/pdf');
const { getBranding, getSetting } = require('../services/settings');
const notificationService = require('../services/notifications/notificationService');
const { mapWithConcurrency } = require('../utils/concurrency');
const { runInTransaction, friendlyConstraint } = require('../utils/tx');
const feeEngine = require('../services/feeEngine');
const voucherPdf = require('../services/voucherPdf');
const { userDesignation, localDateTimeStr } = require('../utils/people');
const feeHeads = require('../utils/feeHeads');

const router = express.Router();
router.use(requireAuth);
const ACCOUNTS = [...ROLE_GROUPS.staffAdmin];

function loadStudentForDoc(db, studentId) {
  return db.prepare(
    `SELECT s.*, c.name || COALESCE(' - ' || sec.name, '') AS class_label, p.full_name AS parent_name, p.email AS parent_email, p.phone AS parent_phone
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN parents p ON p.id = s.parent_id
     WHERE s.id = ?`
  ).get(studentId);
}

// Emails/WhatsApps/SMSes a generated fee document (voucher or receipt PDF) to the
// student's guardian, honoring whichever contact info is on file. Used both for the
// "auto-send" settings toggles and for on-demand "resend" actions from the UI.
async function sendFeeDocument(db, { student, title, message, buffer, fileName, createdBy }) {
  if (!student.parent_email && !student.parent_phone) return { skipped: true };
  return notificationService.sendNotification({
    title,
    message,
    category: 'FeeReminder',
    audienceType: 'Individual',
    audienceRef: JSON.stringify([{ name: student.parent_name, email: student.parent_email, phone: student.parent_phone }]),
    channels: ['email', 'sms', 'whatsapp'],
    createdBy,
    attachment: { buffer, fileName, mimetype: 'application/pdf' }
  });
}

// ---- Fee heads ----
router.get('/heads', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM fee_heads ORDER BY name').all());
}));

// Adds a head, or returns the existing one with the same name ("Transport" =
// "Transport Fee"), so typing a name twice never makes a duplicate.
router.post('/heads', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const name = feeHeads.cleanHeadName(req.body.name);
  if (!name) throw new HttpError(400, 'Enter a fee head name');
  const existing = feeHeads.findHead(db, name);
  if (existing) return res.json({ ...existing, existed: true });
  const id = feeHeads.ensureHead(db, name);
  recordAudit(req, 'create', 'fee_head', id, { name });
  res.status(201).json({ id, name, existed: false });
}));

// Puts back any of the common heads that are missing (Tuition, Exam, Fine…).
router.post('/heads/common', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const added = feeHeads.seedCommonHeads(getDb());
  if (added) recordAudit(req, 'create', 'fee_head', null, { common_heads_added: added });
  res.json({ added });
}));

// ---- Fee structures ----
router.get('/structures', asyncHandler(async (req, res) => {
  const db = getDb();
  const { class_id = '', academic_year = '' } = req.query;
  res.json(db.prepare(
    `SELECT fs.*, fh.name AS fee_head_name, c.name AS class_name FROM fee_structures fs
     JOIN fee_heads fh ON fh.id = fs.fee_head_id
     JOIN classes c ON c.id = fs.class_id
     WHERE (@class_id = '' OR fs.class_id = @class_id) AND (@academic_year = '' OR fs.academic_year = @academic_year)
     ORDER BY c.sort_order, fh.name`
  ).all({ class_id, academic_year }));
}));

router.post('/structures', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const { class_id, amount, frequency, academic_year } = req.body;
  if (!class_id || amount === undefined || amount === '' || !academic_year) {
    throw new HttpError(400, 'Class, fee head, amount and academic year are required');
  }
  const fee_head_id = feeHeads.headFrom(getDb(), req.body);
  if (!fee_head_id) throw new HttpError(400, 'Choose or type a fee head');
  getDb().prepare(
    `INSERT INTO fee_structures (class_id, fee_head_id, amount, frequency, academic_year) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(class_id, fee_head_id, academic_year) DO UPDATE SET amount = excluded.amount, frequency = excluded.frequency`
  ).run(class_id, fee_head_id, amount, frequency || 'Monthly', academic_year);
  recordAudit(req, 'upsert', 'fee_structure', null, { class_id, fee_head_id });
  res.json({ success: true });
}));

// ---- Discounts / scholarships ----
router.get('/discounts', asyncHandler(async (req, res) => {
  const { student_id = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT sfd.*, fh.name AS fee_head_name FROM student_fee_discounts sfd
     LEFT JOIN fee_heads fh ON fh.id = sfd.fee_head_id
     WHERE (@student_id = '' OR sfd.student_id = @student_id) ORDER BY sfd.created_at DESC`
  ).all({ student_id }));
}));

router.post('/discounts', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const { student_id, discount_type, value, reason } = req.body;
  if (!student_id || value === undefined) throw new HttpError(400, 'student_id and value are required');
  const fee_head_id = feeHeads.headFrom(getDb(), req.body);
  const result = getDb().prepare(
    `INSERT INTO student_fee_discounts (student_id, fee_head_id, discount_type, value, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(student_id, fee_head_id || null, discount_type || 'Fixed', value, reason || null, req.user.id);
  recordAudit(req, 'create', 'fee_discount', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

// ---- Invoices ----
// Bulk generation (class / section / whole school, one or several months),
// with optional extra charges (fine, trip, annual charges…). Students who
// already have an invoice for the same month are skipped, so running it twice
// never double-bills. Earlier unpaid dues are not copied into the new invoice:
// they are shown on the voucher as "Arrears" and added to the amount payable.
router.post('/invoices/generate-bulk', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const { class_id, section_id, academic_year, fee_head_id, related_exam_paper_id } = req.body;
  if (!academic_year) throw new HttpError(400, 'academic_year is required');
  const studentIds = req.body.student_id ? [Number(req.body.student_id)] : (Array.isArray(req.body.student_ids) ? req.body.student_ids.map(Number) : undefined);

  let periods = Array.isArray(req.body.periods) && req.body.periods.length ? req.body.periods : null;
  if (!periods) {
    const { period_label, due_date, months_covered } = req.body;
    if (!period_label || !due_date) throw new HttpError(400, 'period_label and due_date (or a periods[] array) are required');
    periods = [{ period_label, due_date, months_covered: months_covered || 1 }];
  }
  for (const p of periods) {
    if (!p.period_label || !p.due_date) throw new HttpError(400, 'each entry in periods[] requires period_label and due_date');
  }
  const extra = Array.isArray(req.body.extra_items) ? req.body.extra_items : [];
  for (const x of extra) {
    if (!(Number(x.amount) > 0) || (!x.fee_head_id && !String(x.name || '').trim())) throw new HttpError(400, 'Each extra charge needs a name and an amount');
  }

  const db = getDb();
  const result = feeEngine.generateInvoices(db, {
    class_id, section_id, academic_year, fee_head_id, related_exam_paper_id, periods, student_ids: studentIds, userId: req.user.id,
    include_transport: req.body.include_transport !== false && req.body.class_fees !== false, class_fees: req.body.class_fees !== false,
    extra_items: extra,
    skip_existing: req.body.skip_existing !== false
  });

  const autoSend = getSetting(db, 'auto_send_fee_vouchers', 'false') === 'true';
  if (autoSend) {
    for (const invoiceId of result.invoiceIds) {
      const data = await buildVoucherPdf(db, invoiceId);
      await sendFeeDocument(db, {
        student: data.student,
        title: 'Fee Voucher',
        message: `Dear ${data.student.parent_name || 'Parent'}, the fee voucher for ${data.student.full_name} (${data.invoice.period_label}) is attached. Amount payable: ${data.payable.toFixed(2)}, due date ${data.invoice.due_date}.`,
        buffer: data.buffer,
        fileName: `voucher-${data.invoice.invoice_number}.pdf`,
        createdBy: req.user.id
      });
    }
  }

  recordAudit(req, 'bulk_generate', 'fee_invoice', null, { created: result.created, skipped: result.skipped, periods: periods.map((p) => p.period_label), fee_head_id, extra, autoSend });
  res.json({ success: true, created: result.created, skipped: result.skipped, invoiceIds: result.invoiceIds });
}));

// ---- KPIs for the Fees page: billed, collected, pending, discounts, advances ----
router.get('/summary', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { from = '', to = '' } = req.query;
  const inv = db.prepare(
    `SELECT COALESCE(SUM(total_amount + fine_amount + concession_amount), 0) AS billed,
            COALESCE(SUM(total_amount + fine_amount - paid_amount), 0) AS pending,
            COALESCE(SUM(paid_amount), 0) AS paid, COUNT(*) AS invoices,
            SUM(CASE WHEN status <> 'Paid' THEN 1 ELSE 0 END) AS open
     FROM fee_invoices WHERE status <> 'Cancelled' AND (@from = '' OR due_date >= @from) AND (@to = '' OR due_date <= @to)`
  ).get({ from, to });
  const pay = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN payment_method <> 'Advance' THEN amount ELSE 0 END), 0) AS collected,
            COALESCE(SUM(discount_amount), 0) AS discounts
     FROM fee_payments WHERE voided_at IS NULL AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)`
  ).get({ from, to });
  const adv = db.prepare(
    `SELECT COALESCE(SUM(bal), 0) AS held, SUM(CASE WHEN bal > 0.001 THEN 1 ELSE 0 END) AS students
     FROM (SELECT student_id, SUM(amount) AS bal FROM fee_advances WHERE voided_at IS NULL GROUP BY student_id)`
  ).get();
  const r = (n) => Math.round(n * 100) / 100;
  res.json({
    billed: r(inv.billed), paid: r(inv.paid), pending: r(Math.max(0, inv.pending)), invoices: inv.invoices, open: inv.open || 0,
    collected: r(pay.collected), discounts: r(pay.discounts), advance: r(adv.held), advanceStudents: adv.students || 0
  });
}));

router.get('/invoices', asyncHandler(async (req, res) => {
  const db = getDb();
  const { student_id = '', status = '', search = '', fee_head_id = '' } = req.query;
  const q = `%${search}%`;
  let scopeFilter = '';
  const params = { student_id, status, search, q, fee_head_id };
  if (req.user.role === 'parent') {
    const parentRow = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(req.user.id);
    scopeFilter = 'AND s.parent_id = @scopeParentId';
    params.scopeParentId = parentRow ? parentRow.id : -1;
  }
  const rows = db.prepare(
    `SELECT fi.*, s.full_name AS student_name, s.student_code, c.name AS class_name, sec.name AS section_name,
            fh.name AS fee_head_name, ep.title AS exam_title
     FROM fee_invoices fi
     JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN fee_heads fh ON fh.id = fi.fee_head_id
     LEFT JOIN exam_papers ep ON ep.id = fi.related_exam_paper_id
     WHERE (@student_id = '' OR fi.student_id = @student_id)
       AND (@status = '' OR fi.status = @status)
       AND (@fee_head_id = '' OR fi.fee_head_id = @fee_head_id)
       AND (@search = '' OR s.full_name LIKE @q OR s.student_code LIKE @q OR fi.invoice_number LIKE @q)
       ${scopeFilter}
     ORDER BY fi.id DESC`
  ).all(params);
  res.json(rows);
}));

router.get('/outstanding', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT fi.*, s.full_name AS student_name, s.student_code, c.name AS class_name, sec.name AS section_name,
            (fi.total_amount + fi.fine_amount - fi.paid_amount) AS balance
     FROM fee_invoices fi
     JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE fi.status NOT IN ('Paid', 'Cancelled')
     ORDER BY fi.due_date`
  ).all();
  res.json(rows);
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const invoice = db.prepare(
    `SELECT fi.*, s.full_name AS student_name, s.student_code FROM fee_invoices fi JOIN students s ON s.id = fi.student_id WHERE fi.id = ?`
  ).get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const items = db.prepare(
    `SELECT fii.*, fh.name AS fee_head_name FROM fee_invoice_items fii JOIN fee_heads fh ON fh.id = fii.fee_head_id WHERE fii.invoice_id = ?`
  ).all(req.params.id);
  const payments = db.prepare(
    `SELECT fp.*, COALESCE(fp.received_by_name, u.full_name) AS received_by_name FROM fee_payments fp LEFT JOIN users u ON u.id = fp.received_by
     WHERE fp.invoice_id = ? ORDER BY fp.payment_date DESC, fp.id DESC`
  ).all(req.params.id);
  res.json({ ...invoice, items, payments });
}));

function voucherSettings(db) {
  return {
    note: getSetting(db, 'voucher_note', ''),
    schoolInfo: require('../services/settings').schoolContactLine(db),
    lateFine: Number(getSetting(db, 'fee_late_fine', '0')) || 0
  };
}

function voucherData(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const items = db.prepare(
    `SELECT fii.*, fh.name AS fee_head_name FROM fee_invoice_items fii JOIN fee_heads fh ON fh.id = fii.fee_head_id WHERE fii.invoice_id = ?`
  ).all(invoiceId);
  const student = loadStudentForDoc(db, invoice.student_id);
  const arrears = invoice.status === 'Cancelled' ? [] : feeEngine.arrearsFor(db, invoice.student_id, invoice);
  const payable = Math.max(0, invoice.total_amount + invoice.fine_amount - invoice.paid_amount) + arrears.reduce((a, r) => a + r.balance, 0);
  const advanceUsed = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM fee_payments WHERE invoice_id = ? AND payment_method = 'Advance' AND voided_at IS NULL`).get(invoiceId).s;
  return { kind: 'student', invoice, items, student, arrears, payable, advanceUsed };
}

async function buildVoucherPdf(db, invoiceId) {
  const v = voucherData(db, invoiceId);
  if (!v) return null;
  const { schoolName, logoPath } = getBranding(db);
  const buffer = await voucherPdf.vouchersPdf([{ ...v, schoolName, logoPath, ...voucherSettings(db) }], { perPage: 2 });
  return { invoice: v.invoice, student: v.student, payable: v.payable, buffer };
}

// Bulk voucher printing — two vouchers per A4 page.
router.get('/vouchers.pdf', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { period_label = '', class_id = '', section_id = '', unpaid = '1', family = '' } = req.query;
  const perPage = [1, 2, 3].includes(Number(req.query.per_page)) ? Number(req.query.per_page) : 2;
  // ids=1,2,3 prints exactly the vouchers ticked on the Invoices list.
  const idList = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
  const idFilter = idList.length ? `AND fi.id IN (${idList.join(',')})` : '';
  const rows = db.prepare(
    `SELECT fi.id, fi.student_id, s.parent_id FROM fee_invoices fi JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE fi.status <> 'Cancelled' AND (@unpaid = '0' OR fi.status <> 'Paid') ${idFilter}
       AND (@period_label = '' OR fi.period_label = @period_label)
       AND (@class_id = '' OR sec.class_id = @class_id) AND (@section_id = '' OR s.section_id = @section_id)
     ORDER BY c.sort_order, sec.name, s.roll_number, s.full_name, fi.due_date`
  ).all({ period_label, class_id, section_id, unpaid: idList.length ? '0' : unpaid });
  if (!rows.length) throw new HttpError(404, 'No vouchers match — generate the invoices first');
  const { schoolName, logoPath } = getBranding(db);
  const extra = { schoolName, logoPath, ...voucherSettings(db) };
  const vouchers = [];
  const doneFamilies = new Set();
  for (const r of rows) {
    // family=1: siblings get one combined voucher instead of one each
    if (family === '1' && r.parent_id) {
      if (doneFamilies.has(r.parent_id)) continue;
      const fam = feeEngine.familyOf(db, r.parent_id);
      if (fam && fam.children.length > 1) {
        doneFamilies.add(r.parent_id);
        vouchers.push({ ...familyVoucherData(db, r.parent_id, period_label), ...extra });
        continue;
      }
    }
    vouchers.push({ ...voucherData(db, r.id), ...extra });
  }
  const buffer = await voucherPdf.vouchersPdf(vouchers, { perPage });
  pdfService.sendPdf(res, `fee-vouchers${period_label ? `-${period_label.replace(/\s+/g, '-')}` : ''}.pdf`, buffer);
}));

// ---- Family (siblings) ----
function familyVoucherData(db, parentId, feeMonth) {
  const fam = feeEngine.familyOf(db, parentId);
  const open = feeEngine.openInvoices(db, fam.children.map((c) => c.id));
  const children = fam.children.map((c) => ({ ...c, invoices: open.filter((i) => i.student_id === c.id) }));
  const month = feeMonth || (open.length ? open[open.length - 1].period_label : '');
  const current = open.filter((i) => i.period_label === month);
  const dueDate = (current.length ? current : open).reduce((m, i) => (!m || i.due_date < m ? i.due_date : m), '');
  return { kind: 'family', parent: fam.parent, children, feeMonth: month, dueDate, total: open.reduce((s, i) => s + i.balance, 0) };
}

router.get('/families', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '', multi = '1' } = req.query;
  const rows = db.prepare(
    `SELECT p.id, p.full_name, p.phone, COUNT(s.id) AS children, GROUP_CONCAT(s.full_name, ', ') AS names,
            (SELECT COALESCE(SUM(fi.total_amount + fi.fine_amount - fi.paid_amount), 0) FROM fee_invoices fi JOIN students s2 ON s2.id = fi.student_id
             WHERE (s2.parent_id = p.id OR s2.secondary_parent_id = p.id) AND fi.status NOT IN ('Paid', 'Cancelled')) AS outstanding
     FROM parents p JOIN students s ON (s.parent_id = p.id OR s.secondary_parent_id = p.id) AND s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')
     WHERE (@search = '' OR p.full_name LIKE @q OR p.phone LIKE @q OR s.full_name LIKE @q)
     GROUP BY p.id HAVING (@multi = '0' OR COUNT(s.id) > 1) ORDER BY p.full_name LIMIT 500`
  ).all({ search, q: `%${search}%`, multi });
  res.json(rows.map((r) => ({ ...r, outstanding: Math.round(r.outstanding * 100) / 100 })));
}));

router.get('/families/:parentId', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  if (!feeEngine.familyOf(db, req.params.parentId)) throw new HttpError(404, 'Family not found');
  res.json(familyVoucherData(db, req.params.parentId, req.query.period_label || ''));
}));

router.get('/families/:parentId/voucher.pdf', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  if (!feeEngine.familyOf(db, req.params.parentId)) throw new HttpError(404, 'Family not found');
  const { schoolName, logoPath } = getBranding(db);
  const buffer = await voucherPdf.vouchersPdf([{ ...familyVoucherData(db, req.params.parentId, req.query.period_label || ''), schoolName, logoPath, ...voucherSettings(db) }], { perPage: 2 });
  pdfService.sendPdf(res, `family-voucher-${req.params.parentId}.pdf`, buffer);
}));

// One amount received for a student (or a whole family) is applied to the
// oldest dues first: arrears, then the current month.
function payDues(req, studentIds) {
  const db = getDb();
  const { amount, discount, keep_extra_as_advance, payment_method, payment_reference, notes, payment_date } = req.body || {};
  try {
    const result = feeEngine.allocatePayment(db, { studentIds, amount, discount, keep_extra_as_advance, payment_method, payment_reference, notes, payment_date, userId: req.user.id });
    return result;
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
}

router.get('/students/:id/dues', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const list = feeEngine.openInvoices(db, [Number(req.params.id)]);
  res.json({ invoices: list, total: Math.round(list.reduce((s, i) => s + i.balance, 0) * 100) / 100, advance: feeEngine.advanceBalance(db, Number(req.params.id)) });
}));

router.get('/advances/:id/receipt.pdf', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const a = db.prepare(`SELECT * FROM fee_advances WHERE id = ? AND kind = 'received'`).get(req.params.id);
  if (!a) throw new HttpError(404, 'Advance not found');
  const student = loadStudentForDoc(db, a.student_id);
  const { schoolName, logoPath, stampPath } = getBranding(db, 'fee_receipts');
  const payment = { receipt_number: a.receipt_number, payment_date: String(a.created_at).slice(0, 10), payment_method: a.payment_method || 'Cash', amount: 0, received_by_name: a.created_by_name, recorded_at: a.created_at, notes: a.notes };
  const buffer = await pdfService.receiptPdf({ schoolName, logoPath, invoice: null, payment, student, stampPath, advance: a.amount });
  pdfService.sendPdf(res, `receipt-${a.receipt_number}.pdf`, buffer);
}));

// Advance: money kept for a student and used on the next vouchers.
router.get('/students/:id/advance', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM fee_advances WHERE student_id = ? AND voided_at IS NULL ORDER BY id DESC').all(req.params.id);
  res.json({ balance: feeEngine.advanceBalance(db, Number(req.params.id)), rows });
}));

router.post('/students/:id/advance', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const student = db.prepare('SELECT id, full_name FROM students WHERE id = ?').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const amount = money(req.body.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Enter the amount received');
  const receipt = ids.receiptNumber(db);
  let used = 0;
  runInTransaction(db, () => {
    feeEngine.addAdvance(db, { studentId: student.id, amount, receiptNumber: receipt, paymentMethod: req.body.payment_method, notes: req.body.notes, userId: req.user.id });
    // Anything already owed is paid from it first (oldest voucher first).
    for (const inv of feeEngine.openInvoices(db, [student.id])) used += feeEngine.applyAdvance(db, inv.id, req.user.id);
  });
  recordAudit(req, 'receive_advance', 'student', student.id, { amount, receipt_number: receipt, used });
  const adv = db.prepare(`SELECT id FROM fee_advances WHERE receipt_number = ? AND kind = 'received' ORDER BY id DESC`).get(receipt);
  res.status(201).json({ id: adv.id, receipt_number: receipt, used: money(used), balance: feeEngine.advanceBalance(db, student.id) });
}));

router.post('/students/:id/pay-dues', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const result = payDues(req, [Number(req.params.id)]);
  recordAudit(req, 'pay_dues', 'student', Number(req.params.id), { amount: req.body.amount, receipts: result.payments.map((p) => p.receipt_number) });
  res.status(201).json(result);
}));

router.post('/families/:parentId/pay', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const fam = feeEngine.familyOf(db, req.params.parentId);
  if (!fam) throw new HttpError(404, 'Family not found');
  const result = payDues(req, fam.children.map((c) => c.id));
  recordAudit(req, 'pay_family_dues', 'parent', fam.parent.id, { amount: req.body.amount, receipts: result.payments.map((p) => p.receipt_number) });
  res.status(201).json(result);
}));

// One receipt covering several payments (a family or arrears payment).
router.get('/receipts/combined.pdf', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const idList = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 100);
  if (!idList.length) throw new HttpError(400, 'No payments');
  const payments = db.prepare(
    `SELECT fp.*, fi.invoice_number, fi.period_label, s.full_name AS student_name, s.student_code, c.name || COALESCE(' - ' || sec.name, '') AS class_label
     FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE fp.id IN (${idList.map(() => '?').join(',')}) ORDER BY fp.id`
  ).all(...idList);
  if (!payments.length) throw new HttpError(404, 'Payments not found');
  const advance = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM fee_advances WHERE kind = 'received' AND voided_at IS NULL AND payment_id IN (${payments.map(() => '?').join(',')})`
  ).get(...payments.map((p) => p.id)).s;
  const { schoolName, logoPath, stampPath } = getBranding(db, 'fee_receipts');
  const buffer = await pdfService.renderPdf((doc) => {
    pdfService.drawHeader(doc, { schoolName, logoPath, subtitle: 'Fee Payment Receipt', badge: 'PAID' });
    const first = payments[0];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const discount = payments.reduce((sum, p) => sum + (p.discount_amount || 0), 0);
    const total = payments.reduce((sum, p) => sum + p.amount, 0) + advance;
    pdfService.drawInfoGrid(doc, [
      [['Receipt No', uniq(payments.map((p) => p.receipt_number)).join(', ')], ['Date', first.payment_date]],
      [['Student Name', uniq(payments.map((p) => p.student_name)).join(', ')], ['Student ID', uniq(payments.map((p) => p.student_code)).join(', ')]],
      [['Class', uniq(payments.map((p) => p.class_label)).join(', ') || '-'], ['Fee Month', uniq(payments.map((p) => p.period_label)).join(', ')]],
      [['Payment Method', first.payment_method + (first.payment_reference ? ` (${first.payment_reference})` : '')], ['Amount Received', total.toFixed(2)]],
      ...(discount > 0 || advance > 0 ? [[['Discount Allowed', discount.toFixed(2)], ['Kept as Advance', advance.toFixed(2)]]] : []),
      [['Received By', first.received_by_name || '-'], ['Recorded At', String(first.recorded_at || '').slice(0, 16)]]
    ]);
    pdfService.drawTable(doc, {
      columns: [
        { key: 'period', label: 'Fee Month', width: 110 }, { key: 'student', label: 'Student', width: 150 },
        { key: 'voucher', label: 'Voucher', width: 90 }, { key: 'discount', label: 'Discount', width: 70, align: 'right' }, { key: 'amount', label: 'Amount', width: 75, align: 'right' }
      ],
      rows: payments.map((p) => ({ period: p.period_label, student: p.student_name, voucher: p.invoice_number, discount: p.discount_amount ? p.discount_amount.toFixed(2) : '-', amount: p.amount.toFixed(2) }))
    });
    doc.font('Helvetica-Bold').fontSize(13).text(`Total Received: ${total.toFixed(2)}`, pdfService.PAGE_LEFT, doc.y, { width: pdfService.PAGE_WIDTH, align: 'right' });
    pdfService.drawPrintedSignatures(doc, [{ caption: 'Received & Recorded By', name: first.received_by_name, detail: String(first.recorded_at || '').slice(0, 16) }, { caption: 'Parent / Guardian' }], stampPath, 0);
  });
  pdfService.sendPdf(res, 'receipt.pdf', buffer);
}));

// ---- Automatic monthly fees ----
const AUTO_KEYS = ['auto_fee_enabled', 'auto_fee_day', 'auto_fee_due_day', 'auto_fee_academic_year', 'auto_fee_extras', 'voucher_note', 'fee_late_fine'];
router.get('/auto-settings', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const out = Object.fromEntries(AUTO_KEYS.map((k) => [k, getSetting(db, k, '')]));
  out.academic_year = getSetting(db, 'academic_year', '');
  out.last_month = getSetting(db, 'auto_fee_last_month', '');
  try { out.last_result = JSON.parse(getSetting(db, 'auto_fee_last_result', 'null')); } catch { out.last_result = null; }
  res.json(out);
}));

router.put('/auto-settings', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  for (const k of AUTO_KEYS) {
    if (b[k] === undefined) continue;
    let v = b[k];
    if (k === 'auto_fee_extras') v = JSON.stringify(Array.isArray(v) ? v.filter((x) => x && String(x.name || '').trim() && Number(x.amount) > 0).map((x) => ({ name: String(x.name).trim(), amount: Number(x.amount), per_month: true })) : []);
    if (['auto_fee_day', 'auto_fee_due_day'].includes(k) && !(Number(v) >= 1 && Number(v) <= 28)) throw new HttpError(400, 'Days must be between 1 and 28');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  }
  recordAudit(req, 'update', 'auto_fee_settings', null, b);
  res.json({ success: true });
}));

router.post('/auto-run-now', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const r = feeEngine.autoMonthlyRun(getDb(), { force: true });
  recordAudit(req, 'auto_fee_run', 'fee_invoice', null, { created: r.created, skipped: r.skipped, month: r.month });
  res.json({ ...r, invoiceIds: undefined });
}));

router.get('/invoices/:id/voucher.pdf', asyncHandler(async (req, res) => {
  const data = await buildVoucherPdf(getDb(), req.params.id);
  if (!data) throw new HttpError(404, 'Invoice not found');
  pdfService.sendPdf(res, `voucher-${data.invoice.invoice_number}.pdf`, data.buffer);
}));

router.post('/invoices/:id/send-voucher', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const data = await buildVoucherPdf(db, req.params.id);
  if (!data) throw new HttpError(404, 'Invoice not found');
  const balance = data.invoice.total_amount + data.invoice.fine_amount - data.invoice.paid_amount;
  const result = await sendFeeDocument(db, {
    student: data.student,
    title: 'Fee Voucher',
    message: `Dear ${data.student.parent_name || 'Parent'}, the fee voucher for ${data.student.full_name} (${data.invoice.period_label}) is attached. Amount payable: ${data.payable.toFixed(2)}, due date ${data.invoice.due_date}.`,
    buffer: data.buffer,
    fileName: `voucher-${data.invoice.invoice_number}.pdf`,
    createdBy: req.user.id
  });
  if (result.skipped) throw new HttpError(400, 'This student has no guardian email or phone on file');
  recordAudit(req, 'send_voucher', 'fee_invoice', Number(req.params.id));
  res.json(result);
}));

router.post('/invoices/:id/pay', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const { payment_method, notes, payment_date, payment_reference } = req.body;
  const received = money(req.body.amount || 0);
  const discount = money(req.body.discount || 0);
  if (!(received >= 0) || !(discount >= 0)) throw new HttpError(400, 'Amounts cannot be negative');
  if (!(received > 0) && !(discount > 0)) throw new HttpError(400, 'A positive amount is required');
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'Cancelled') throw new HttpError(400, 'This invoice was cancelled — payments cannot be recorded against it');
  const balance = money(invoice.total_amount + invoice.fine_amount - invoice.paid_amount);
  if (discount > balance + 0.001) throw new HttpError(400, `The discount (${discount.toFixed(2)}) is more than the balance (${balance.toFixed(2)})`);
  // Anything paid beyond the balance is kept as advance for the next voucher.
  const amount = money(Math.min(received, balance - discount));
  const advance = money(received - amount);

  const receiptNo = ids.receiptNumber(db);
  // Who received the money and the exact time are taken from the login and the
  // server clock — they are printed on the receipt instead of a signature.
  const receiver = userDesignation(db, req.user.id);
  let result;
  let newStatus;
  runInTransaction(db, () => {
    result = db.prepare(
      `INSERT INTO fee_payments (invoice_id, receipt_number, amount, discount_amount, payment_method, payment_date, received_by, notes, recorded_at, received_by_name, payment_reference)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')), ?, ?, ?, ?, ?)`
    ).run(req.params.id, receiptNo, amount, discount, payment_method || 'Cash', payment_date || null, req.user.id, notes || null,
      localDateTimeStr(), receiver.name, String(payment_reference || '').trim() || null);
    newStatus = recomputeInvoice(db, req.params.id).status;
    if (advance > 0) {
      feeEngine.addAdvance(db, { studentId: invoice.student_id, amount: advance, receiptNumber: receiptNo, paymentMethod: payment_method, notes, userId: req.user.id, paymentId: Number(result.lastInsertRowid) });
    }
  });

  recordAudit(req, 'pay', 'fee_invoice', Number(req.params.id), { amount, discount, advance, receipt_number: receiptNo });

  if (getSetting(db, 'auto_send_fee_receipts', 'false') === 'true') {
    const paymentId = Number(result.lastInsertRowid);
    sendReceiptDocument(db, paymentId, req.user.id).catch(() => {});
  }

  res.status(201).json({ id: Number(result.lastInsertRowid), receipt_number: receiptNo, status: newStatus, discount, advance });
}));

async function buildReceiptPdf(db, paymentId) {
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(paymentId);
  if (!payment) return null;
  if (payment.received_by) {
    const r = userDesignation(db, payment.received_by);
    payment.received_by_name = payment.received_by_name || r.name;
    payment.received_by_designation = r.designation;
  }
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(payment.invoice_id);
  const student = loadStudentForDoc(db, invoice.student_id);
  const { schoolName, logoPath, stampPath } = getBranding(db, 'fee_receipts');
  const advance = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM fee_advances WHERE payment_id = ? AND kind = 'received' AND voided_at IS NULL`).get(payment.id).s;
  const buffer = await pdfService.receiptPdf({ schoolName, logoPath, invoice, payment, student, stampPath, advance });
  return { payment, invoice, student, buffer };
}

async function sendReceiptDocument(db, paymentId, createdBy) {
  const data = await buildReceiptPdf(db, paymentId);
  if (!data) return { skipped: true };
  return sendFeeDocument(db, {
    student: data.student,
    title: 'Fee Payment Receipt',
    message: `Dear ${data.student.parent_name || 'Parent'}, thank you for your payment of ${data.payment.amount.toFixed(2)} for ${data.student.full_name} (Receipt ${data.payment.receipt_number}). Receipt attached.`,
    buffer: data.buffer,
    fileName: `receipt-${data.payment.receipt_number}.pdf`,
    createdBy
  });
}

// All payments (receipts) in a period, newest first.
router.get('/payments', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const { from = '', to = '', search = '', method = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT fp.*, COALESCE(fp.received_by_name, u.full_name) AS received_by_name, fi.invoice_number, fi.period_label,
            s.full_name AS student_name, s.student_code, c.name || ' - ' || sec.name AS class_name
     FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students s ON s.id = fi.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN users u ON u.id = fp.received_by
     WHERE (@from = '' OR fp.payment_date >= @from) AND (@to = '' OR fp.payment_date <= @to)
       AND (@method = '' OR fp.payment_method = @method)
       AND (@search = '' OR s.full_name LIKE @q OR s.student_code LIKE @q OR fp.receipt_number LIKE @q OR fi.invoice_number LIKE @q)
     ORDER BY fp.payment_date DESC, fp.id DESC LIMIT 1000`
  ).all({ from, to, search, method, q: `%${search}%` }));
}));

router.get('/payments/:paymentId/receipt.pdf', asyncHandler(async (req, res) => {
  const data = await buildReceiptPdf(getDb(), req.params.paymentId);
  if (!data) throw new HttpError(404, 'Payment not found');
  pdfService.sendPdf(res, `receipt-${data.payment.receipt_number}.pdf`, data.buffer);
}));

router.post('/payments/:paymentId/send-receipt', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const result = await sendReceiptDocument(getDb(), req.params.paymentId, req.user.id);
  if (result.skipped) throw new HttpError(400, 'This student has no guardian email or phone on file');
  recordAudit(req, 'send_receipt', 'fee_payment', Number(req.params.paymentId));
  res.json(result);
}));

router.post('/remind-overdue', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const overdue = db.prepare(
    `SELECT fi.*, s.full_name AS student_name, p.full_name AS parent_name, p.email, p.phone
     FROM fee_invoices fi JOIN students s ON s.id = fi.student_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE fi.status NOT IN ('Paid', 'Cancelled') AND fi.due_date < date('now', 'localtime')`
  ).all();

  const remindable = overdue.filter((inv) => inv.email || inv.phone);
  const results = await mapWithConcurrency(remindable, 5, (inv) => {
    const message = `Dear ${inv.parent_name || 'Parent'}, a fee payment of ${(inv.total_amount + inv.fine_amount - inv.paid_amount).toFixed(2)} for ${inv.student_name} (Invoice ${inv.invoice_number}) is overdue since ${inv.due_date}. Please clear it at your earliest convenience.`;
    return notificationService.sendNotification({
      title: 'Fee Due Reminder',
      message,
      category: 'FeeReminder',
      audienceType: 'Individual',
      audienceRef: JSON.stringify([{ name: inv.parent_name, email: inv.email, phone: inv.phone }]),
      channels: ['email', 'sms'],
      createdBy: req.user.id
    });
  });
  const notified = results.length;
  recordAudit(req, 'send_fee_reminders', 'fee_invoice', null, { notified });
  res.json({ success: true, notified });
}));

// =====================================================================
// Corrections: everything below lets office staff fix mistakes (a wrong
// amount, a duplicate invoice, a payment entered twice) without deleting
// history. Every change is written to the audit log with the old values.
// =====================================================================

const money = (v) => Math.round(Number(v) * 100) / 100;

// paid_amount/status are always derived from the (non-voided) payments, so
// they can never drift out of step after an edit or a voided payment.
const recomputeInvoice = feeEngine.recomputeInvoice;

// ---- Fee heads ----
router.put('/heads/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const name = feeHeads.cleanHeadName(req.body.name);
  if (!name) throw new HttpError(400, 'name is required');
  const clash = feeHeads.findHead(getDb(), name);
  if (clash && clash.id !== Number(req.params.id)) throw new HttpError(400, `"${clash.name}" already exists — use that head instead`);
  try {
    getDb().prepare('UPDATE fee_heads SET name = ? WHERE id = ?').run(name, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A fee head with that name already exists' });
  }
  recordAudit(req, 'update', 'fee_head', Number(req.params.id), { name });
  res.json({ success: true });
}));

router.delete('/heads/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const used = db.prepare(
    `SELECT (SELECT COUNT(*) FROM fee_structures WHERE fee_head_id = @id) + (SELECT COUNT(*) FROM fee_invoice_items WHERE fee_head_id = @id) AS c`
  ).get({ id: Number(req.params.id) }).c;
  if (used) throw new HttpError(409, 'This fee head is used by fee structures or invoices — rename it instead of deleting');
  db.prepare('DELETE FROM fee_heads WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'fee_head', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Fee structures ----
router.put('/structures/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM fee_structures WHERE id = ?').get(req.params.id);
  if (!before) throw new HttpError(404, 'Fee structure not found');
  const { amount, frequency, academic_year } = req.body;
  if (amount !== undefined && (Number.isNaN(Number(amount)) || Number(amount) < 0)) throw new HttpError(400, 'amount must be 0 or more');
  try {
    db.prepare(
      `UPDATE fee_structures SET amount = COALESCE(?, amount), frequency = COALESCE(?, frequency), academic_year = COALESCE(?, academic_year) WHERE id = ?`
    ).run(amount === undefined || amount === '' ? null : Number(amount), frequency || null, academic_year || null, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'That class already has this fee head for that academic year' });
  }
  recordAudit(req, 'update', 'fee_structure', Number(req.params.id), { before: { amount: before.amount, frequency: before.frequency }, amount, frequency });
  res.json({ success: true, note: 'Only invoices generated from now on use the new amount. Edit existing invoices individually if needed.' });
}));

router.delete('/structures/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare('DELETE FROM fee_structures WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'fee_structure', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Discounts ----
router.put('/discounts/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const { discount_type, value, reason } = req.body;
  if (value !== undefined && (Number.isNaN(Number(value)) || Number(value) < 0)) throw new HttpError(400, 'value must be 0 or more');
  const db = getDb();
  const fee_head_id = feeHeads.headFrom(db, req.body);
  const row = db.prepare('SELECT id FROM student_fee_discounts WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Discount not found');
  db.prepare(
    `UPDATE student_fee_discounts SET fee_head_id = ?, discount_type = COALESCE(?, discount_type), value = COALESCE(?, value), reason = ? WHERE id = ?`
  ).run(fee_head_id || null, discount_type || null, value === undefined ? null : Number(value), reason || null, req.params.id);
  recordAudit(req, 'update', 'fee_discount', Number(req.params.id), req.body);
  res.json({ success: true });
}));

router.delete('/discounts/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare('DELETE FROM student_fee_discounts WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'fee_discount', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Invoices: edit amounts / items / dates ----
router.put('/invoices/:id', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'Cancelled') throw new HttpError(400, 'Cancelled invoices cannot be edited');
  const { period_label, due_date, fine_amount, items } = req.body;
  const beforeItems = db.prepare('SELECT fee_head_id, amount, discount_amount FROM fee_invoice_items WHERE invoice_id = ?').all(invoice.id);

  let newItems = null;
  if (items !== undefined) {
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'An invoice needs at least one fee line');
    newItems = items.map((it) => ({
      fee_head_id: feeHeads.headFrom(db, it),
      amount: money(it.amount),
      discount_amount: money(it.discount_amount || 0)
    }));
    for (const it of newItems) {
      if (!it.fee_head_id) throw new HttpError(400, 'Each fee line needs a fee head');
      if (Number.isNaN(it.amount) || it.amount < 0) throw new HttpError(400, 'Fee amounts must be 0 or more');
      if (Number.isNaN(it.discount_amount) || it.discount_amount < 0 || it.discount_amount > it.amount) {
        throw new HttpError(400, 'A discount must be between 0 and the fee amount');
      }
    }
  }
  const fine = fine_amount === undefined || fine_amount === '' ? invoice.fine_amount : money(fine_amount);
  if (Number.isNaN(fine) || fine < 0) throw new HttpError(400, 'Fine must be 0 or more');
  const total = newItems ? money(newItems.reduce((s, it) => s + it.amount - it.discount_amount, 0) - (invoice.concession_amount || 0)) : invoice.total_amount;
  const paid = money(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM fee_payments WHERE invoice_id = ? AND voided_at IS NULL').get(invoice.id).s);
  if (total < 0 || money(total + fine) < paid) {
    throw new HttpError(400, `The new total (${(total + fine).toFixed(2)}) is less than what has already been paid (${paid.toFixed(2)}). Void or correct the payment first.`);
  }

  runInTransaction(db, () => {
    if (newItems) {
      db.prepare('DELETE FROM fee_invoice_items WHERE invoice_id = ?').run(invoice.id);
      const insert = db.prepare('INSERT INTO fee_invoice_items (invoice_id, fee_head_id, amount, discount_amount) VALUES (?, ?, ?, ?)');
      newItems.forEach((it) => insert.run(invoice.id, it.fee_head_id, it.amount, it.discount_amount));
    }
    db.prepare(
      `UPDATE fee_invoices SET period_label = COALESCE(?, period_label), due_date = COALESCE(?, due_date),
         fine_amount = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(period_label ? String(period_label).trim() : null, due_date || null, fine, total, invoice.id);
    recomputeInvoice(db, invoice.id);
  });

  recordAudit(req, 'edit_invoice', 'fee_invoice', invoice.id, {
    before: { total_amount: invoice.total_amount, fine_amount: invoice.fine_amount, period_label: invoice.period_label, due_date: invoice.due_date, items: beforeItems },
    after: { total_amount: total, fine_amount: fine, period_label, due_date, items: newItems }
  });
  res.json({ success: true, ...recomputeInvoice(db, invoice.id) });
}));

// Cancelling keeps the invoice (and its number) for the record, but it no
// longer counts as money owed. Only possible while nothing has been paid on it.
router.post('/invoices/:id/cancel', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'Cancelled') return res.json({ success: true });
  const activePayments = db.prepare('SELECT COUNT(*) AS c FROM fee_payments WHERE invoice_id = ? AND voided_at IS NULL').get(invoice.id).c;
  if (activePayments) throw new HttpError(400, 'This invoice has payments recorded. Void those payments first, then cancel the invoice.');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Please give a reason for cancelling');
  db.prepare(
    `UPDATE fee_invoices SET status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(req.user.id, reason, invoice.id);
  recordAudit(req, 'cancel_invoice', 'fee_invoice', invoice.id, { reason, total_amount: invoice.total_amount });
  res.json({ success: true });
}));

router.post('/invoices/:id/restore', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status !== 'Cancelled') return res.json({ success: true });
  db.prepare(`UPDATE fee_invoices SET status = 'Pending', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invoice.id);
  recomputeInvoice(db, invoice.id);
  recordAudit(req, 'restore_invoice', 'fee_invoice', invoice.id);
  res.json({ success: true });
}));

// ---- Payments: correct or void ----
router.put('/payments/:paymentId', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(req.params.paymentId);
  if (!payment) throw new HttpError(404, 'Payment not found');
  if (payment.voided_at) throw new HttpError(400, 'This payment was voided and cannot be edited');
  const { amount, payment_method, payment_date, notes, payment_reference } = req.body;
  if (amount !== undefined && (!(Number(amount) > 0))) throw new HttpError(400, 'Amount must be more than 0');
  const amountChanged = amount !== undefined && money(amount) !== payment.amount;
  runInTransaction(db, () => {
    db.prepare(
      `UPDATE fee_payments SET amount = COALESCE(?, amount), payment_method = COALESCE(?, payment_method),
         payment_date = COALESCE(?, payment_date), notes = ?, payment_reference = ? WHERE id = ?`
    ).run(amount === undefined ? null : money(amount), payment_method || null, payment_date || null,
      notes === undefined ? payment.notes : (notes || null),
      payment_reference === undefined ? payment.payment_reference : (String(payment_reference || '').trim() || null), payment.id);
    // A verified amount that is later changed needs verifying again.
    if (amountChanged) db.prepare('UPDATE fee_payments SET verified_by = NULL, verified_by_name = NULL, verified_by_designation = NULL, verified_at = NULL WHERE id = ?').run(payment.id);
    recomputeInvoice(db, payment.invoice_id);
  });
  recordAudit(req, 'edit_payment', 'fee_payment', payment.id, {
    before: { amount: payment.amount, payment_method: payment.payment_method, payment_date: payment.payment_date },
    after: { amount, payment_method, payment_date }
  });
  res.json({ success: true });
}));

// Verification: a second person (or the Principal / Admin) confirms the money
// was actually received. Name, designation and time are stored and printed.
router.post('/payments/:paymentId/verify', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(req.params.paymentId);
  if (!payment) throw new HttpError(404, 'Payment not found');
  if (payment.voided_at) throw new HttpError(400, 'This payment was voided');
  const who = userDesignation(db, req.user.id);
  const at = localDateTimeStr();
  db.prepare('UPDATE fee_payments SET verified_by = ?, verified_by_name = ?, verified_by_designation = ?, verified_at = ? WHERE id = ?')
    .run(req.user.id, who.name, who.designation, at, payment.id);
  recordAudit(req, 'verify_payment', 'fee_payment', payment.id, { receipt_number: payment.receipt_number, amount: payment.amount, verified_at: at });
  res.json({ success: true, verified_by_name: who.name, verified_by_designation: who.designation, verified_at: at });
}));

router.post('/payments/:paymentId/unverify', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(req.params.paymentId);
  if (!payment) throw new HttpError(404, 'Payment not found');
  db.prepare('UPDATE fee_payments SET verified_by = NULL, verified_by_name = NULL, verified_by_designation = NULL, verified_at = NULL WHERE id = ?').run(payment.id);
  recordAudit(req, 'unverify_payment', 'fee_payment', payment.id, { was: { verified_by_name: payment.verified_by_name, verified_at: payment.verified_at } });
  res.json({ success: true });
}));

router.post('/payments/:paymentId/void', requireAccess('fees', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(req.params.paymentId);
  if (!payment) throw new HttpError(404, 'Payment not found');
  if (payment.voided_at) return res.json({ success: true });
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Please give a reason for voiding this payment');
  runInTransaction(db, () => {
    db.prepare('UPDATE fee_payments SET voided_at = CURRENT_TIMESTAMP, voided_by = ?, void_reason = ? WHERE id = ?').run(req.user.id, reason, payment.id);
    db.prepare('UPDATE fee_advances SET voided_at = CURRENT_TIMESTAMP WHERE payment_id = ? AND voided_at IS NULL').run(payment.id);
    recomputeInvoice(db, payment.invoice_id);
  });
  recordAudit(req, 'void_payment', 'fee_payment', payment.id, { reason, amount: payment.amount, receipt_number: payment.receipt_number });
  res.json({ success: true });
}));

module.exports = router;
