// Fee vouchers: a large school logo, the fee month under the school name,
// this month's charges plus arrears (earlier unpaid dues) and the total
// payable. Two vouchers fit on one A4 page for bulk printing, with a cut line.
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { dmyDoc } = require('../utils/dmy');

const BRAND = '#1d4ed8';
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 24;
const f2 = (n) => Number(n || 0).toFixed(2);

function header(doc, x, y, w, { schoolName, logoPath, title, feeMonth, badge, schoolInfo, compact }) {
  const logo = compact ? 44 : 66;
  const hasLogo = logoPath && fs.existsSync(logoPath);
  if (hasLogo) {
    try { doc.image(logoPath, x, y, { fit: [logo, logo] }); } catch { /* unreadable logo */ }
  }
  const tx = x + (hasLogo ? logo + 8 : 0);
  const tw = w - (hasLogo ? logo + 8 : 0) - (badge ? 70 : 0);
  let nameColor = BRAND;
  try { nameColor = require('./settings').schoolNameColor(require('../db/connection').getDb(), BRAND); } catch { /* default colour */ }
  doc.fillColor(nameColor).font('Helvetica-Bold').fontSize(compact ? 14 : 17).text(schoolName, tx, y + 2, { width: tw, align: 'center' });
  if (schoolInfo && !compact) doc.fillColor('#555').font('Helvetica').fontSize(7.5).text(schoolInfo, tx, doc.y, { width: tw, align: 'center' });
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text(title, tx, doc.y + 2, { width: tw, align: 'center' });
  if (feeMonth) {
    const my = doc.y + 3;
    doc.font('Helvetica-Bold').fontSize(12);
    const label = `Fee Month: ${feeMonth}`;
    const lw = doc.widthOfString(label) + 18;
    const lx = tx + (tw - lw) / 2;
    doc.roundedRect(lx, my, lw, 19, 4).fill('#eef2ff');
    doc.fillColor(BRAND).text(label, lx, my + 4, { width: lw, align: 'center' });
  }
  const textBottom = doc.y;
  if (badge) {
    doc.font('Helvetica-Bold').fontSize(9);
    const bw = doc.widthOfString(badge) + 14;
    doc.roundedRect(x + w - bw, y, bw, 18, 3).lineWidth(1).strokeColor('#111').stroke();
    doc.fillColor('#111').text(badge, x + w - bw, y + 5, { width: bw, align: 'center' });
  }
  doc.fillColor('#000');
  // (the badge text moves doc.y back up, so measure from the text above it)
  const bottom = Math.max(textBottom + 4, y + logo + 2);
  doc.moveTo(x, bottom).lineTo(x + w, bottom).lineWidth(1.2).strokeColor(BRAND).stroke().strokeColor('#000');
  return bottom + 6;
}

function infoGrid(doc, x, y, w, pairs) {
  const rowH = 17;
  const half = w / 2;
  doc.lineWidth(0.6).strokeColor('#c7ccd6');
  pairs.forEach((row, i) => {
    row.forEach(([label, value], c) => {
      const cx = x + c * half;
      const cy = y + i * rowH;
      doc.rect(cx, cy, half, rowH).stroke();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#555').text(String(label).toUpperCase(), cx + 4, cy + 5, { width: 70, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor('#000').text(String(value ?? '-'), cx + 76, cy + 4.5, { width: half - 80, lineBreak: false, ellipsis: true });
    });
  });
  doc.strokeColor('#000');
  return y + pairs.length * rowH + 6;
}

function linesTable(doc, x, y, w, lines, maxY) {
  const rowH = 15;
  doc.rect(x, y, w, rowH).fillAndStroke('#eef2f9', '#c7ccd6');
  doc.fillColor('#333').font('Helvetica-Bold').fontSize(8.5);
  doc.text('#', x + 4, y + 4, { width: 18 });
  doc.text('Description', x + 24, y + 4, { width: w - 130 });
  doc.text('Amount', x + w - 100, y + 4, { width: 94, align: 'right' });
  let cy = y + rowH;
  let shown = 0;
  for (const [i, l] of lines.entries()) {
    if (cy + rowH > maxY - 60 && i < lines.length - 1) {
      const rest = lines.slice(i).reduce((s, r) => s + Number(r.amount || 0), 0);
      lines = [...lines.slice(0, i), { label: `Other charges (${lines.length - i} items)`, amount: rest }];
    }
    if (i >= lines.length) break;
    const line = lines[i];
    doc.rect(x, cy, w, rowH).lineWidth(0.5).strokeColor('#d5dae3').stroke();
    doc.fillColor(line.color || '#000').font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    doc.text(String(i + 1), x + 4, cy + 4, { width: 18 });
    doc.text(line.label, x + 24, cy + 4, { width: w - 130, lineBreak: false, ellipsis: true });
    doc.text(`${line.amount < 0 ? '- ' : ''}${f2(Math.abs(line.amount))}`, x + w - 100, cy + 4, { width: 94, align: 'right' });
    cy += rowH;
    shown += 1;
  }
  doc.fillColor('#000').strokeColor('#000');
  return { y: cy + 4, shown };
}

function totalBox(doc, x, y, w, { total, dueDate, lateFine }) {
  doc.roundedRect(x, y, w, 28, 4).fillAndStroke('#f3f6fd', BRAND);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text(`TOTAL PAYABLE: ${f2(total)}`, x + 8, y + 8, { width: w / 2 });
  doc.fillColor('#111').font('Helvetica').fontSize(8.5)
    .text(`Pay by ${dueDate}${lateFine > 0 ? `   ·   After due date: ${f2(total + lateFine)}` : ''}`, x + w / 2, y + 10, { width: w / 2 - 8, align: 'right' });
  doc.fillColor('#000');
  return y + 34;
}

function footer(doc, x, y, w, note) {
  let fy = y;
  if (note) { doc.font('Helvetica').fontSize(8).fillColor('#333').text(note, x, y, { width: w }); fy = doc.y + 2; }
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#888').text('Computer-generated voucher — no signature required. Keep the receipt after payment.', x, fy, { width: w, align: 'center' });
  doc.fillColor('#000');
}

/**
 * One student's voucher inside a box. v: { schoolName, logoPath, schoolInfo, note, lateFine,
 *   invoice, items:[{fee_head_name, amount, discount_amount}], student, arrears:[{period_label, balance}] }
 */
function drawStudentVoucher(doc, box, v) {
  const { x, y, w, h } = box;
  const { invoice, student } = v;
  let cy = header(doc, x, y, w, { schoolName: v.schoolName, logoPath: v.logoPath, schoolInfo: v.schoolInfo, compact: v.compact, title: 'FEE VOUCHER', feeMonth: invoice.period_label, badge: invoice.status === 'Paid' ? 'PAID' : null });
  cy = infoGrid(doc, x, cy, w, [
    [['Voucher No', invoice.invoice_number], ['Issue Date', String(invoice.created_at || '').slice(0, 10)]],
    [['Student', student.full_name], ['Student ID', student.student_code]],
    [['Class', student.class_label || '-'], ['Due Date', invoice.due_date]]
  ]);
  const lines = v.items.map((it) => ({ label: `${it.fee_head_name}${it.discount_amount ? ` (less discount ${f2(it.discount_amount)})` : ''}`, amount: it.amount - (it.discount_amount || 0) }));
  if (invoice.fine_amount) lines.push({ label: 'Fine', amount: invoice.fine_amount });
  const arrears = v.arrears || [];
  const arrearsTotal = arrears.reduce((s, a) => s + a.balance, 0);
  if (arrearsTotal > 0) lines.push({ label: `Arrears — previous dues (${arrears.map((a) => a.period_label).join(', ')})`, amount: arrearsTotal, bold: true, color: '#b91c1c' });
  if (invoice.concession_amount > 0) lines.push({ label: 'Less: discount allowed', amount: -invoice.concession_amount, color: '#047857' });
  const fromAdvance = Math.min(v.advanceUsed || 0, invoice.paid_amount);
  if (fromAdvance > 0) lines.push({ label: 'Less: adjusted from advance paid earlier', amount: -fromAdvance, color: '#047857' });
  if (invoice.paid_amount - fromAdvance > 0.001) lines.push({ label: 'Less: already paid on this voucher', amount: -(invoice.paid_amount - fromAdvance) });
  const t = linesTable(doc, x, cy, w, lines, y + h);
  const thisBalance = invoice.total_amount + invoice.fine_amount - invoice.paid_amount;
  cy = totalBox(doc, x, t.y, w, { total: thisBalance + arrearsTotal, dueDate: invoice.due_date, lateFine: v.lateFine });
  if (!v.compact) footer(doc, x, cy, w, v.note);
}

/** A family voucher: every child's dues for the month plus arrears, one total. */
function drawFamilyVoucher(doc, box, v) {
  const { x, y, w, h } = box;
  let cy = header(doc, x, y, w, { schoolName: v.schoolName, logoPath: v.logoPath, schoolInfo: v.schoolInfo, compact: v.compact, title: 'FAMILY FEE VOUCHER', feeMonth: v.feeMonth });
  cy = infoGrid(doc, x, cy, w, [
    [['Family of', v.parent.full_name], ['Phone', v.parent.phone || '-']],
    [['Students', v.children.map((c) => c.full_name).join(', ')], ['Student IDs', v.children.map((c) => c.student_code).join(', ')]],
    [['Due Date', v.dueDate || '-'], ['', '']]
  ]);
  const lines = [];
  for (const c of v.children) {
    for (const inv of c.invoices) {
      lines.push({ label: `${c.full_name} (${c.class_label || '-'}) — ${inv.period_label}${inv.period_label !== v.feeMonth && v.feeMonth ? ' (arrears)' : ''}`, amount: inv.balance, color: inv.period_label !== v.feeMonth && v.feeMonth ? '#b91c1c' : '#000' });
    }
  }
  if (!lines.length) lines.push({ label: 'Nothing due — all fees are paid', amount: 0 });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const t = linesTable(doc, x, cy, w, lines, y + h);
  cy = totalBox(doc, x, t.y, w, { total, dueDate: v.dueDate || '-', lateFine: v.lateFine });
  if (!v.compact) footer(doc, x, cy, w, v.note);
}

/** vouchers: [{ kind: 'student'|'family', ...data }]; perPage 1, 2 or 3. */
function vouchersPdf(vouchers, { perPage = 2 } = {}) {
  return new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: MARGIN, size: 'A4' }));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const w = PAGE_W - MARGIN * 2;
    const h = (PAGE_H - MARGIN * 2 - 24 * (perPage - 1)) / perPage;
    vouchers.forEach((v, i) => {
      const slot = i % perPage;
      if (i > 0 && slot === 0) doc.addPage();
      const y = MARGIN + slot * (h + 24);
      if (slot > 0) {
        const cut = y - 12;
        doc.save().dash(4, { space: 4 }).moveTo(MARGIN - 10, cut).lineTo(PAGE_W - MARGIN + 10, cut).lineWidth(0.6).strokeColor('#999').stroke().undash().restore();
        doc.font('Helvetica').fontSize(7).fillColor('#999').text('cut here', MARGIN, cut - 9, { width: w, align: 'center' }).fillColor('#000');
      }
      const box = { x: MARGIN, y, w, h };
      const data = { ...v, compact: perPage >= 3 };
      if (v.kind === 'family') drawFamilyVoucher(doc, box, data); else drawStudentVoucher(doc, box, data);
    });
    if (!vouchers.length) doc.font('Helvetica').fontSize(12).text('No vouchers to print.');
    doc.end();
  });
}

module.exports = { vouchersPdf };
