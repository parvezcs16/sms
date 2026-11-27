// Fee invoice generation, arrears and payment allocation — shared by the
// Fees routes, the family voucher and the automatic monthly run.
const ids = require('../utils/ids');
const { localDateStr } = require('../utils/localDate');
const { localDateTimeStr, userDesignation } = require('../utils/people');
const { runInTransaction } = require('../utils/tx');
const { getSetting } = require('./settings');

const money = (v) => Math.round(Number(v) * 100) / 100;
const OPEN = "status NOT IN ('Paid', 'Cancelled')";
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Finds a head by name ("Transport" = "Transport Fee") or creates it.
function headId(db, name) {
  return require('../utils/feeHeads').ensureHead(db, name);
}

function computeItems(structures, discounts, monthsCovered) {
  return structures.map((s) => {
    const multiplier = s.frequency === 'Monthly' ? monthsCovered : 1;
    const baseAmount = s.amount * multiplier;
    const applicable = discounts.filter((d) => !d.fee_head_id || d.fee_head_id === s.fee_head_id);
    let discountAmount = 0;
    applicable.forEach((d) => { discountAmount += d.discount_type === 'Percent' ? (baseAmount * d.value) / 100 : d.value; });
    return { fee_head_id: s.fee_head_id, amount: baseAmount, discount_amount: Math.min(discountAmount, baseAmount) };
  });
}

/**
 * Creates invoices for every current student in scope.
 * opts: { class_id, section_id, student_ids, academic_year, fee_head_id, related_exam_paper_id, periods: [{period_label, due_date, months_covered}],
 *         include_transport (default true), extra_items: [{ name | fee_head_id, amount, per_month }], skip_existing (default true) }
 * Returns { created, skipped, invoiceIds }.
 */
function generateInvoices(db, opts) {
  const { class_id, section_id, academic_year, fee_head_id, related_exam_paper_id } = opts;
  const periods = opts.periods;
  const students = db.prepare(
    `SELECT s.*, sec.class_id AS class_id FROM students s JOIN sections sec ON sec.id = s.section_id
     WHERE s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')
       AND (@section_id = '' OR s.section_id = @section_id)
       AND (@class_id = '' OR sec.class_id = @class_id)`
  ).all({ section_id: section_id || '', class_id: class_id || '' })
    .filter((s) => !Array.isArray(opts.student_ids) || opts.student_ids.map(Number).includes(s.id));

  const structuresByClass = new Map();
  const discountsByStudent = new Map();
  if (students.length) {
    const classIds = [...new Set(students.map((s) => s.class_id))];
    const params = fee_head_id ? [...classIds, academic_year, fee_head_id] : [...classIds, academic_year];
    db.prepare(
      `SELECT fs.* FROM fee_structures fs WHERE fs.class_id IN (${classIds.map(() => '?').join(',')}) AND fs.academic_year = ? ${fee_head_id ? 'AND fs.fee_head_id = ?' : ''}`
    ).all(...params).forEach((s) => {
      if (!structuresByClass.has(s.class_id)) structuresByClass.set(s.class_id, []);
      structuresByClass.get(s.class_id).push(s);
    });
    db.prepare(`SELECT * FROM student_fee_discounts WHERE student_id IN (${students.map(() => '?').join(',')})`).all(...students.map((s) => s.id)).forEach((d) => {
      if (!discountsByStudent.has(d.student_id)) discountsByStudent.set(d.student_id, []);
      discountsByStudent.get(d.student_id).push(d);
    });
  }

  // School transport fares (see Transport) — skipped when billing one other head only.
  let transportHeadId = null;
  const rides = new Map();
  const transportRows = opts.include_transport === false ? [] : db.prepare(
    `SELECT st.student_id, st.start_date, st.end_date, COALESCE(st.monthly_fee, r.monthly_fee) AS fee
     FROM student_transport st JOIN transport_routes r ON r.id = st.route_id`
  ).all();
  if (transportRows.length) {
    transportHeadId = headId(db, 'Transport Fee');
    if (fee_head_id && Number(fee_head_id) !== transportHeadId) transportHeadId = null;
    transportRows.forEach((t) => { if (!rides.has(t.student_id)) rides.set(t.student_id, []); rides.get(t.student_id).push(t); });
  }

  // Extra one-off / monthly charges added to every invoice in this run
  // (fine, trip, annual charges, anything else).
  const extras = (opts.extra_items || []).filter((x) => Number(x.amount) > 0).map((x) => ({
    fee_head_id: x.fee_head_id ? Number(x.fee_head_id) : headId(db, String(x.name || 'Miscellaneous').trim() || 'Miscellaneous'),
    amount: money(x.amount),
    frequency: x.per_month ? 'Monthly' : 'OneTime'
  }));

  const insertInvoice = db.prepare(
    `INSERT INTO fee_invoices (student_id, invoice_number, period_label, due_date, total_amount, fee_head_id, related_exam_paper_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare('INSERT INTO fee_invoice_items (invoice_id, fee_head_id, amount, discount_amount) VALUES (?, ?, ?, ?)');
  const existing = db.prepare(
    `SELECT id FROM fee_invoices WHERE student_id = ? AND period_label = ? AND status <> 'Cancelled' AND COALESCE(fee_head_id, 0) = ?`
  );

  let created = 0;
  let skipped = 0;
  const invoiceIds = [];
  runInTransaction(db, () => {
    periods.forEach((period, periodIndex) => {
      const monthsCovered = Number(period.months_covered) || 1;
      for (const student of students) {
        if (opts.skip_existing !== false && existing.get(student.id, period.period_label, Number(fee_head_id) || 0)) { skipped += 1; continue; }
        const all = opts.class_fees === false ? [] : (structuresByClass.get(student.class_id) || []);
        // One-time / annual heads are billed once even when several months are generated together.
        const structures = periodIndex === 0 ? all : all.filter((s) => s.frequency === 'Monthly');
        const discounts = discountsByStudent.get(student.id) || [];
        const items = computeItems(structures, discounts, monthsCovered);
        if (transportHeadId) {
          const ride = (rides.get(student.id) || []).find((t) => t.start_date <= period.due_date && (!t.end_date || t.end_date >= period.due_date));
          if (ride && ride.fee > 0) items.push(...computeItems([{ fee_head_id: transportHeadId, amount: ride.fee, frequency: 'Monthly' }], discounts.filter((d) => d.fee_head_id === transportHeadId), monthsCovered));
        }
        const ex = periodIndex === 0 ? extras : extras.filter((x) => x.frequency === 'Monthly');
        items.push(...computeItems(ex, discounts.filter((d) => ex.some((x) => x.fee_head_id === d.fee_head_id)), monthsCovered));
        if (!items.length) continue;
        const total = money(items.reduce((sum, i) => sum + i.amount - i.discount_amount, 0));
        const r = insertInvoice.run(student.id, ids.invoiceNumber(db), period.period_label, period.due_date, total, fee_head_id || null, related_exam_paper_id || null);
        const invoiceId = Number(r.lastInsertRowid);
        items.forEach((i) => insertItem.run(invoiceId, i.fee_head_id, i.amount, i.discount_amount));
        // Money the student paid in advance is used on the new voucher straight away.
        applyAdvance(db, invoiceId, opts.userId || null);
        invoiceIds.push(invoiceId);
        created += 1;
      }
    });
  });
  return { created, skipped, invoiceIds };
}

// paid_amount / concession_amount / status are always derived from the
// (non-voided) payments. A discount given while receiving a fee lowers the
// invoice total, so the voucher is fully settled instead of "Partial".
function recomputeInvoice(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const sums = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(discount_amount), 0) AS disc FROM fee_payments WHERE invoice_id = ? AND voided_at IS NULL'
  ).get(invoiceId);
  const paid = money(sums.paid);
  const concession = money(sums.disc);
  const total = money(invoice.total_amount + (invoice.concession_amount || 0) - concession);
  let status = invoice.status;
  if (status !== 'Cancelled') {
    const due = money(total + invoice.fine_amount);
    status = paid <= 0 && concession <= 0 ? 'Pending' : paid + 0.001 >= due ? 'Paid' : 'Partial';
  }
  db.prepare('UPDATE fee_invoices SET paid_amount = ?, concession_amount = ?, total_amount = ?, status = ? WHERE id = ?').run(paid, concession, total, status, invoiceId);
  return { ...invoice, paid_amount: paid, concession_amount: concession, total_amount: total, status };
}

// ---- Advances: money received beyond what is owed ----
function advanceBalance(db, studentId) {
  return money(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM fee_advances WHERE student_id = ? AND voided_at IS NULL').get(studentId).s);
}

function addAdvance(db, { studentId, amount, receiptNumber, paymentMethod, notes, userId, paymentId }) {
  const who = userDesignation(db, userId);
  db.prepare(
    `INSERT INTO fee_advances (student_id, amount, kind, payment_id, receipt_number, payment_method, notes, created_by, created_by_name, created_at)
     VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?)`
  ).run(studentId, money(amount), paymentId || null, receiptNumber || null, paymentMethod || 'Cash', notes || null, userId || null, who.name, localDateTimeStr());
}

// Pays an open invoice from the student's advance (as a payment with mode
// "Advance"), so the voucher shows it as already paid.
function applyAdvance(db, invoiceId, userId) {
  const inv = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'Cancelled' || inv.status === 'Paid') return 0;
  const available = advanceBalance(db, inv.student_id);
  const owed = money(inv.total_amount + inv.fine_amount - inv.paid_amount);
  const use = money(Math.min(available, owed));
  if (!(use > 0)) return 0;
  const who = userId ? userDesignation(db, userId) : { name: 'System (advance)' };
  const at = localDateTimeStr();
  const receipt = ids.receiptNumber(db);
  const r = db.prepare(
    `INSERT INTO fee_payments (invoice_id, receipt_number, amount, payment_method, payment_date, received_by, notes, recorded_at, received_by_name)
     VALUES (?, ?, ?, 'Advance', ?, ?, 'Adjusted from advance', ?, ?)`
  ).run(inv.id, receipt, use, localDateStr(), userId || null, at, who.name);
  db.prepare(
    `INSERT INTO fee_advances (student_id, amount, kind, invoice_id, payment_id, receipt_number, payment_method, notes, created_by, created_by_name, created_at)
     VALUES (?, ?, 'used', ?, ?, ?, 'Advance', ?, ?, ?, ?)`
  ).run(inv.student_id, -use, inv.id, Number(r.lastInsertRowid), receipt, `Used on ${inv.invoice_number} (${inv.period_label})`, userId || null, who.name, at);
  recomputeInvoice(db, inv.id);
  return use;
}

// Earlier unpaid invoices of a student (arrears), shown on a voucher.
function arrearsFor(db, studentId, beforeInvoice) {
  return db.prepare(
    `SELECT id, invoice_number, period_label, due_date, ROUND(total_amount + fine_amount - paid_amount, 2) AS balance
     FROM fee_invoices WHERE student_id = ? AND ${OPEN} AND id <> ?
       AND (due_date < ? OR (due_date = ? AND id < ?))
     ORDER BY due_date, id`
  ).all(studentId, beforeInvoice.id, beforeInvoice.due_date, beforeInvoice.due_date, beforeInvoice.id).filter((a) => a.balance > 0);
}

function openInvoices(db, studentIds) {
  if (!studentIds.length) return [];
  return db.prepare(
    `SELECT fi.*, ROUND(fi.total_amount + fi.fine_amount - fi.paid_amount, 2) AS balance, s.full_name AS student_name
     FROM fee_invoices fi JOIN students s ON s.id = fi.student_id
     WHERE fi.student_id IN (${studentIds.map(() => '?').join(',')}) AND fi.${OPEN}
     ORDER BY fi.due_date, fi.id`
  ).all(...studentIds).filter((i) => i.balance > 0);
}

/**
 * Applies one amount to the oldest unpaid invoices first (arrears before the
 * current month), recording one payment per invoice touched. Any extra beyond
 * what is owed is refused. Returns the created payments.
 */
function allocatePayment(db, { studentIds, amount, discount, keep_extra_as_advance, payment_method, payment_reference, notes, payment_date, userId }) {
  const invoices = openInvoices(db, studentIds);
  const owed = money(invoices.reduce((s, i) => s + i.balance, 0));
  amount = money(amount || 0);
  discount = money(discount || 0);
  if (!(amount >= 0) || !(discount >= 0)) throw Object.assign(new Error('Amounts cannot be negative'), { status: 400 });
  if (!(amount > 0) && !(discount > 0)) throw Object.assign(new Error('Enter the amount received'), { status: 400 });
  if (discount > owed + 0.001) throw Object.assign(new Error(`The discount (${discount.toFixed(2)}) is more than what is owed (${owed.toFixed(2)})`), { status: 400 });
  const extra = money(amount + discount - owed);
  if (extra > 0.001 && !keep_extra_as_advance) throw Object.assign(new Error(`Only ${owed.toFixed(2)} is owed — the amount is more than that`), { status: 400 });
  if (extra > 0.001 && studentIds.length !== 1) throw Object.assign(new Error(`Only ${owed.toFixed(2)} is owed. To keep money in advance, receive it on one student.`), { status: 400 });
  const who = userDesignation(db, userId);
  const at = localDateTimeStr();
  const created = [];
  let advance = 0;
  runInTransaction(db, () => {
    let cash = amount;
    let disc = discount;
    for (const inv of invoices) {
      if (cash <= 0 && disc <= 0) break;
      const part = money(Math.min(cash, inv.balance));
      const discPart = money(Math.min(disc, inv.balance - part));
      if (!(part > 0) && !(discPart > 0)) continue;
      const receipt = ids.receiptNumber(db);
      const r = db.prepare(
        `INSERT INTO fee_payments (invoice_id, receipt_number, amount, discount_amount, payment_method, payment_date, received_by, notes, recorded_at, received_by_name, payment_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(inv.id, receipt, part, discPart, payment_method || 'Cash', payment_date || localDateStr(), userId, notes || null, at, who.name, payment_reference || null);
      recomputeInvoice(db, inv.id);
      created.push({ id: Number(r.lastInsertRowid), receipt_number: receipt, invoice_id: inv.id, invoice_number: inv.invoice_number, period_label: inv.period_label, student_name: inv.student_name, amount: part, discount: discPart });
      cash = money(cash - part);
      disc = money(disc - discPart);
    }
    if (cash > 0.001) {
      advance = cash;
      const last = created[created.length - 1];
      addAdvance(db, { studentId: studentIds[0], amount: cash, receiptNumber: last ? last.receipt_number : ids.receiptNumber(db), paymentMethod: payment_method, notes, userId, paymentId: last ? last.id : null });
    }
  });
  return { payments: created, owed, remaining: money(Math.max(0, owed - amount - discount)), advance };
}

// Parents with their current children, for family vouchers.
function familyOf(db, parentId) {
  const parent = db.prepare('SELECT * FROM parents WHERE id = ?').get(parentId);
  if (!parent) return null;
  const children = db.prepare(
    `SELECT s.id, s.full_name, s.student_code, s.roll_number, c.name || ' - ' || sec.name AS class_label
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE (s.parent_id = ? OR s.secondary_parent_id = ?) AND s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')
     ORDER BY c.sort_order, s.full_name`
  ).all(parentId, parentId);
  return { parent, children };
}

function monthLabel(d = new Date()) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The automatic monthly run (scheduler): on/after the configured day, once per month.
function autoMonthlyRun(db, { force = false, now = new Date() } = {}) {
  const enabled = getSetting(db, 'auto_fee_enabled', 'false') === 'true';
  if (!enabled && !force) return { ran: false, reason: 'Automatic monthly fees are switched off' };
  const day = Math.min(28, Math.max(1, Number(getSetting(db, 'auto_fee_day', '1')) || 1));
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!force && now.getDate() < day) return { ran: false, reason: `Runs on day ${day} of the month` };
  if (!force && getSetting(db, 'auto_fee_last_month', '') === monthKey) return { ran: false, reason: 'Already generated this month' };
  const academicYear = getSetting(db, 'auto_fee_academic_year', '') || getSetting(db, 'academic_year', '') || String(now.getFullYear());
  const dueDay = Math.min(28, Math.max(1, Number(getSetting(db, 'auto_fee_due_day', '10')) || 10));
  let extras = [];
  try { extras = JSON.parse(getSetting(db, 'auto_fee_extras', '[]')) || []; } catch { extras = []; }
  const result = generateInvoices(db, {
    academic_year: academicYear,
    periods: [{ period_label: monthLabel(now), due_date: `${monthKey}-${String(dueDay).padStart(2, '0')}`, months_covered: 1 }],
    extra_items: extras.filter((x) => x.per_month).map((x) => ({ ...x, per_month: true }))
  });
  db.prepare(`INSERT INTO settings (key, value) VALUES ('auto_fee_last_month', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(monthKey);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('auto_fee_last_result', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(JSON.stringify({ at: localDateTimeStr(), month: monthLabel(now), academic_year: academicYear, ...result, invoiceIds: undefined }));
  return { ran: true, month: monthLabel(now), academic_year: academicYear, created: result.created, skipped: result.skipped, invoiceIds: result.invoiceIds };
}

module.exports = { generateInvoices, arrearsFor, openInvoices, allocatePayment, recomputeInvoice, advanceBalance, addAdvance, applyAdvance, familyOf, autoMonthlyRun, monthLabel, headId, money, OPEN };
