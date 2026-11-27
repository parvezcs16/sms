const fs = require('fs');
const PDFDocument = require('pdfkit');
const { dmyDoc } = require('../utils/dmy');
const { drawMixed, hasUrdu, isRtl } = require('./pdfText');

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;
const BRAND_COLOR = '#1d4ed8';

// All PDFs are built into an in-memory buffer (documents here are tiny — a
// page or two) so the exact same bytes can be sent as an HTTP download, an
// email attachment, or a WhatsApp document, without generating it twice.
function renderPdf(build) {
  return new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: 40, size: 'A4' }));
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function sendPdf(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
}

// Letterhead: logo top-left, school name as the main heading, subtitle (e.g.
// "Fee Voucher") as the heading beneath it, and an optional status badge
// top-right — the same layout family as a standard printed office voucher.
// The school's address and phone, read once per document.
function nameColor() {
  try {
    const { getDb } = require('../db/connection');
    return require('./settings').schoolNameColor(getDb(), BRAND_COLOR);
  } catch {
    return BRAND_COLOR;
  }
}

function contactLine() {
  try {
    const { getDb } = require('../db/connection');
    return require('./settings').schoolContactLine(getDb());
  } catch {
    return '';
  }
}

function drawHeader(doc, { schoolName, logoPath, subtitle, badge, contact }) {
  const top = doc.y;
  const info = contact !== undefined ? contact : contactLine();
  const hasLogo = logoPath && fs.existsSync(logoPath);
  if (hasLogo) {
    try {
      doc.image(logoPath, PAGE_LEFT, top, { fit: [46, 46] });
    } catch {
      // Corrupt/unsupported image file — skip the logo rather than fail the whole PDF.
    }
  }
  if (badge) drawBadge(doc, badge, top);

  doc.fillColor(nameColor()).font('Helvetica-Bold').fontSize(17).text(schoolName, PAGE_LEFT, top, { width: PAGE_WIDTH, align: 'center' });
  if (info) {
    const inset = badge ? 110 : 56;
    doc.fillColor('#555').font('Helvetica').fontSize(8.5).text(info, PAGE_LEFT + inset, doc.y + 1, { width: PAGE_WIDTH - inset * 2, align: 'center' });
  }
  if (subtitle) {
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(13).text(subtitle, PAGE_LEFT, doc.y + 2, { width: PAGE_WIDTH, align: 'center' });
  }
  doc.fillColor('#000');
  doc.x = PAGE_LEFT;
  doc.y = Math.max(doc.y, top + 46) + 10;
  doc.moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_RIGHT, doc.y).lineWidth(1.2).strokeColor(BRAND_COLOR).stroke().strokeColor('#000').lineWidth(1);
  doc.moveDown();
}

function drawBadge(doc, text, top) {
  doc.font('Helvetica-Bold').fontSize(9);
  const width = doc.widthOfString(text) + 16;
  const x = PAGE_RIGHT - width;
  doc.roundedRect(x, top, width, 20, 3).stroke();
  doc.text(text, x, top + 6, { width, align: 'center' });
}

// A bordered two-column-of-pairs info grid, e.g.
// [Invoice No | value] [Due Date | value]
// [Student    | value] [Class    | value]
function drawInfoGrid(doc, rows) {
  const labelWidth = 105;
  const colWidth = PAGE_WIDTH / 2;
  const valueWidth = colWidth - labelWidth - 10;
  const startX = PAGE_LEFT;
  let y = doc.y;

  doc.lineWidth(0.75).strokeColor('#c7ccd6');
  rows.forEach((pair) => {
    // Each row is as tall as its longest value, so long names never spill
    // into the next row.
    const rowHeight = Math.max(22, ...pair.map(([label, value]) => Math.max(
      doc.font('Helvetica').fontSize(10).heightOfString(String(value ?? '-'), { width: valueWidth }),
      doc.font('Helvetica-Bold').fontSize(9).heightOfString(String(label).toUpperCase(), { width: labelWidth - 10 })
    ) + 12));
    doc.rect(startX, y, PAGE_WIDTH, rowHeight).stroke();
    doc.moveTo(startX + colWidth, y).lineTo(startX + colWidth, y + rowHeight).stroke();
    doc.moveTo(startX + labelWidth, y).lineTo(startX + labelWidth, y + rowHeight).stroke();
    doc.moveTo(startX + colWidth + labelWidth, y).lineTo(startX + colWidth + labelWidth, y + rowHeight).stroke();

    pair.forEach(([label, value], col) => {
      const cellX = startX + col * colWidth;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(String(label).toUpperCase(), cellX + 6, y + 7, { width: labelWidth - 10 });
      doc.font('Helvetica').fontSize(10).fillColor('#000').text(String(value ?? '-'), cellX + labelWidth + 6, y + 6, { width: valueWidth });
    });
    y += rowHeight;
  });
  doc.strokeColor('#000');
  doc.y = y + 14;
  doc.x = PAGE_LEFT;
}

// A bordered table with a shaded header row. `columns`: [{key,label,width,align}].
function drawTable(doc, { columns, rows, zebra = true, fontSize = 9.5 }) {
  const headSize = fontSize - 0.5;
  const minRow = 20;
  const startX = PAGE_LEFT;
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  let y = doc.y;
  // Every row is as tall as its longest cell, so a long name wraps inside its
  // own row instead of running over the next one.
  const cellHeight = (text, col, bold) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? headSize : fontSize)
    .heightOfString(String(text ?? ''), { width: col.width - 10 });

  function header() {
    const h = Math.max(minRow, ...columns.map((c) => cellHeight(c.label, c, true) + 11));
    doc.rect(startX, y, tableWidth, h).fillAndStroke('#eef2f9', '#c7ccd6');
    let x = startX;
    doc.font('Helvetica-Bold').fontSize(headSize).fillColor('#333');
    columns.forEach((col) => {
      doc.text(col.label, x + 5, y + 6, { width: col.width - 10, align: col.align || 'left' });
      x += col.width;
    });
    doc.fillColor('#000');
    y += h;
  }

  header();
  rows.forEach((row, idx) => {
    const h = Math.max(minRow, ...columns.map((c) => cellHeight(row[c.key], c, false) + 11));
    if (y + h > 790) {
      doc.addPage();
      y = 40;
      header();
    }
    if (zebra && idx % 2 === 1) doc.rect(startX, y, tableWidth, h).fill('#f7f9fc').fillColor('#000');
    doc.rect(startX, y, tableWidth, h).lineWidth(0.6).strokeColor('#c7ccd6').stroke().strokeColor('#000');
    let x = startX;
    doc.font('Helvetica').fontSize(fontSize);
    columns.forEach((col, ci) => {
      if (ci > 0) doc.moveTo(x, y).lineTo(x, y + h).lineWidth(0.4).strokeColor('#dde2ea').stroke().strokeColor('#000');
      doc.fillColor('#000').text(String(row[col.key] ?? ''), x + 5, y + 5.5, { width: col.width - 10, align: col.align || 'left' });
      x += col.width;
    });
    y += h;
  });

  doc.y = y + 12;
  doc.x = PAGE_LEFT;
}

function drawSignatureLines(doc, leftLabel, rightLabel) {
  doc.moveDown(2);
  const y = doc.y;
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_LEFT + 200, y).stroke();
  doc.moveTo(PAGE_LEFT + 300, y).lineTo(PAGE_RIGHT, y).stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(leftLabel, PAGE_LEFT, y + 4, { width: 200, align: 'center' });
  doc.text(rightLabel, PAGE_LEFT + 300, y + 4, { width: PAGE_WIDTH - 300, align: 'center' });
  doc.fillColor('#000');
}

// Printed names in place of handwritten signatures: each block shows the
// person's name (and designation / time beneath it) above a caption, e.g.
// "Ali Raza · Accountant · 2026-11-24 10:42" over "Received By".
// A block with no name keeps an empty signature line.
// A school stamp (PNG/JPEG), slightly tilted like a rubber stamp. Leaves the
// text cursor where it was.
function drawStamp(doc, stampPath, cx, cy, size = 78) {
  if (!stampPath || !fs.existsSync(stampPath)) return;
  const { x, y } = doc;
  try {
    doc.save();
    doc.opacity(0.88);
    doc.rotate(-8, { origin: [cx, cy] });
    doc.image(stampPath, cx - size / 2, cy - size / 2, { fit: [size, size], align: 'center', valign: 'center' });
  } catch { /* unreadable image — print without the stamp */ } finally {
    doc.restore();
    doc.x = x; doc.y = y;
  }
}

// `stampPath` (optional): stamped over the last signature block (Principal /
// Verified By), as an office would after signing.
function drawPrintedSignatures(doc, blocks, stampPath, stampAt) {
  doc.moveDown(1.5);
  if (doc.y > (stampPath ? 660 : 700)) doc.addPage();
  const y = doc.y;
  const gap = 20;
  const w = (PAGE_WIDTH - gap * (blocks.length - 1)) / blocks.length;
  // All signature lines sit on one level, under the tallest name block.
  const heightOf = (b) => {
    if (!b.name) return 22;
    let h = doc.font('Helvetica-Bold').fontSize(10).heightOfString(b.name, { width: w });
    if (b.detail) h += doc.font('Helvetica').fontSize(8).heightOfString(b.detail, { width: w });
    return h;
  };
  const lineY = y + Math.max(22, ...blocks.map(heightOf)) + 3;
  let bottom = lineY;
  blocks.forEach((b, i) => {
    const x = PAGE_LEFT + i * (w + gap);
    if (b.name) {
      const h = heightOf(b);
      let ty = lineY - 3 - h;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(b.name, x, ty, { width: w, align: 'center' });
      ty = doc.y;
      if (b.detail) doc.font('Helvetica').fontSize(8).fillColor('#444').text(b.detail, x, ty, { width: w, align: 'center' });
    }
    doc.moveTo(x, lineY).lineTo(x + w, lineY).lineWidth(0.8).strokeColor('#555').stroke().strokeColor('#000');
    doc.font('Helvetica').fontSize(8.5).fillColor('#555').text(b.caption, x, lineY + 3, { width: w, align: 'center' });
    bottom = Math.max(bottom, doc.y);
  });
  if (stampPath) {
    // Over the middle block for 3+ blocks (the Parent/Guardian column stays clear), else the last.
    // (or the block index given in `stampAt`).
    const i = Number.isInteger(stampAt) ? stampAt : blocks.length >= 3 ? blocks.length - 2 : blocks.length - 1;
    drawStamp(doc, stampPath, PAGE_LEFT + i * (w + gap) + w / 2 + (blocks.length >= 3 ? 0 : 24), lineY - 22);
  }
  doc.fillColor('#000');
  doc.x = PAGE_LEFT;
  doc.y = bottom + 6;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#777')
    .text('Computer-generated record: names above are recorded automatically by the system and stand in place of handwritten signatures.', PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'center' });
  doc.fillColor('#000');
}

const fmtTime = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 16) : '');

// One receipt. `advance` = money kept for the next vouchers; `discount` =
// concession allowed at the counter. invoice may be null (advance only).
function receiptPdf({ schoolName, logoPath, invoice, payment, student, stampPath, advance = 0 }) {
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName, logoPath, subtitle: 'Fee Payment Receipt', badge: 'PAID' });
    const received = Number(payment.amount || 0) + Number(advance || 0);
    const rows = [
      [['Receipt No', payment.receipt_number], ['Date', payment.payment_date]],
      [['Student Name', student.full_name], ['Student ID', student.student_code]],
      [['Class', student.class_label || '-'], ['Fee Month', invoice ? invoice.period_label : 'Advance']],
      [['Voucher No', invoice ? invoice.invoice_number : '-'], ['Payment Method', payment.payment_method + (payment.payment_reference ? ` (${payment.payment_reference})` : '')]],
      [['Amount Received', received.toFixed(2)], payment.discount_amount > 0 ? ['Discount Allowed', Number(payment.discount_amount).toFixed(2)] : ['Received By', payment.received_by_name || '-']]
    ];
    if (advance > 0) rows.push([['Kept as Advance', Number(advance).toFixed(2)], ['Used On', 'Next fee voucher(s)']]);
    if (payment.discount_amount > 0) rows.push([['Received By', payment.received_by_name || '-'], ['Recorded At', fmtTime(payment.recorded_at) || payment.payment_date]]);
    else rows.push([['Recorded At', fmtTime(payment.recorded_at) || payment.payment_date], ['', '']]);
    drawInfoGrid(doc, rows);
    if (payment.notes) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(10).text(`Notes: ${payment.notes}`); }

    drawPrintedSignatures(doc, [
      { caption: 'Received & Recorded By', name: payment.received_by_name, detail: [payment.received_by_designation, fmtTime(payment.recorded_at)].filter(Boolean).join(' · ') },
      { caption: 'Verified By', name: payment.verified_by_name, detail: [payment.verified_by_designation, fmtTime(payment.verified_at)].filter(Boolean).join(' · ') }
    ], stampPath);
  });
}

function invoicePdf({ schoolName, logoPath, invoice, items, student }) {
  const balance = invoice.total_amount + invoice.fine_amount - invoice.paid_amount;
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName, logoPath, subtitle: 'Fee Voucher', badge: invoice.status?.toUpperCase() });
    drawInfoGrid(doc, [
      [['Voucher No', invoice.invoice_number], ['Due Date', invoice.due_date]],
      [['Student', `${student.full_name} (${student.student_code})`], ['Class', student.class_label || '-']],
      [['Period', invoice.period_label], ['Status', invoice.status]]
    ]);

    drawTable(doc, {
      columns: [
        { key: 'sr', label: 'SR', width: 35, align: 'center' },
        { key: 'fee_head_name', label: 'Fee Head', width: 340 },
        { key: 'amount', label: 'Amount', width: 140, align: 'right' }
      ],
      rows: items.map((item, i) => ({
        sr: i + 1,
        fee_head_name: item.fee_head_name,
        amount: (item.amount - (item.discount_amount || 0)).toFixed(2)
      })),
      zebra: false
    });

    doc.font('Helvetica-Bold').fontSize(12).text(`Total Due: ${balance.toFixed(2)}`, PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'right' });
    drawSignatureLines(doc, 'Prepared By', 'Received By (Parent/Guardian)');
  });
}

function payslipPdf({ schoolName, logoPath, teacher, run, stampPath }) {
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName, logoPath, subtitle: 'Salary Payslip', badge: run.status?.toUpperCase() });
    drawInfoGrid(doc, [
      [['Payslip No', run.payslip_number], ['Period', `${run.month}/${run.year}`]],
      [['Employee', `${teacher.full_name} (${teacher.teacher_code})`], ['Designation', teacher.designation || '-']]
    ]);

    const allowances = JSON.parse(teacher.allowances_json || '[]');
    const deductions = JSON.parse(teacher.deductions_json || '[]');
    const lines = [{ label: 'Basic Salary', amount: run.basic }, ...allowances.map((a) => ({ label: a.label, amount: Number(a.amount) }))];
    const deductionLines = [...deductions.map((d) => ({ label: d.label, amount: Number(d.amount) }))];
    if (run.advance_deduction) deductionLines.push({ label: 'Salary Advance Recovery', amount: run.advance_deduction });

    doc.font('Helvetica-Bold').fontSize(11).text('Earnings', PAGE_LEFT, doc.y);
    doc.moveDown(0.3);
    drawTable(doc, {
      columns: [{ key: 'label', label: 'Description', width: 375 }, { key: 'amount', label: 'Amount', width: 140, align: 'right' }],
      rows: lines.map((l) => ({ label: l.label, amount: l.amount.toFixed(2) })),
      zebra: false
    });

    if (deductionLines.length) {
      doc.font('Helvetica-Bold').fontSize(11).text('Deductions', PAGE_LEFT, doc.y);
      doc.moveDown(0.3);
      drawTable(doc, {
        columns: [{ key: 'label', label: 'Description', width: 375 }, { key: 'amount', label: 'Amount', width: 140, align: 'right' }],
        rows: deductionLines.map((l) => ({ label: l.label, amount: l.amount.toFixed(2) })),
        zebra: false
      });
    }

    doc.font('Helvetica-Bold').fontSize(13).text(`Net Salary: ${run.net_salary.toFixed(2)}`, PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'right' });

    if (run.status === 'Paid') {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11).text('Payment Details', PAGE_LEFT, doc.y);
      doc.moveDown(0.3);
      drawInfoGrid(doc, [
        [['Paid To', teacher.full_name], ['Amount', run.net_salary.toFixed(2)]],
        [['Payment Mode', run.payment_mode || '-'], ['Reference', run.payment_reference || '-']],
        [['Paid On', fmtTime(run.paid_at) || '-'], ['Paid By', run.paid_by_name || '-']]
      ]);
    }

    drawPrintedSignatures(doc, [
      { caption: run.status === 'Paid' ? 'Paid By' : 'Prepared By', name: run.paid_by_name, detail: fmtTime(run.paid_at) },
      { caption: 'Approved / Verified By', name: run.approved_by_name, detail: [run.approved_by_designation, fmtTime(run.approved_at)].filter(Boolean).join(' · ') },
      { caption: 'Employee Signature' }
    ], stampPath);
  });
}

const URDU_OPTION_LABELS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و'];

// Questions may be in English, Urdu, or a mix: each question is laid out in its
// own direction (Urdu right-to-left with Urdu option labels), in the order and
// with the marks the teacher chose.
function examPaperPdf({ schoolName, logoPath, paper, questions }) {
  return renderPdf((doc) => {
    const urduTitle = hasUrdu(paper.title);
    drawHeader(doc, { schoolName, logoPath, subtitle: urduTitle ? null : paper.title });
    if (urduTitle) {
      drawMixed(doc, paper.title, { x: PAGE_LEFT, width: PAGE_WIDTH, size: 14, bold: true, align: 'center' });
      doc.moveDown(0.4);
    }
    const total = questions.reduce((sum, q) => sum + Number(q.marks_override || q.marks || 0), 0);
    drawInfoGrid(doc, [
      [['Class', paper.class_name || '-'], ['Subject', paper.subject_name || '-']],
      [['Term', paper.term || '-'], ['Total Marks', total || paper.total_marks]],
      [['Duration', `${paper.duration_minutes} minutes`], ['Questions', questions.length]]
    ]);
    if (paper.instructions) {
      if (hasUrdu(paper.instructions)) drawMixed(doc, paper.instructions, { x: PAGE_LEFT, width: PAGE_WIDTH, size: 10.5 });
      else doc.font('Helvetica-Oblique').fontSize(10).text(`Instructions: ${paper.instructions}`);
      doc.moveDown(0.6);
    }

    const bottom = () => doc.page.height - doc.page.margins.bottom;
    questions.forEach((q, idx) => {
      const marks = q.marks_override || q.marks;
      const rtl = isRtl(q.question_text);
      if (doc.y > bottom() - 50) doc.addPage();
      const top = doc.y;
      const numW = 30;
      const marksW = 58;
      const textX = rtl ? PAGE_LEFT + marksW : PAGE_LEFT + numW;
      const textW = PAGE_WIDTH - numW - marksW;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
      if (rtl) {
        doc.text(`${idx + 1}.`, PAGE_RIGHT - numW + 4, top + 3, { width: numW - 4, align: 'right', lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor('#444').text(`[${marks} marks]`, PAGE_LEFT, top + 4, { width: marksW, lineBreak: false });
      } else {
        doc.text(`Q${idx + 1}.`, PAGE_LEFT, top, { width: numW, lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor('#444').text(`[${marks} marks]`, PAGE_RIGHT - marksW, top + 1, { width: marksW, align: 'right', lineBreak: false });
      }
      doc.fillColor('#000');
      let y = drawMixed(doc, q.question_text, { x: textX, y: top, width: textW, size: 11, rtl });

      if (q.question_type === 'MCQ' && q.options_json) {
        let options = [];
        try { options = JSON.parse(q.options_json) || []; } catch { options = []; }
        options.forEach((opt, i) => {
          const optRtl = rtl || isRtl(opt);
          const label = optRtl ? `(${URDU_OPTION_LABELS[i] || i + 1})` : `${String.fromCharCode(97 + i)})`;
          y = drawMixed(doc, `${label} ${opt}`, { x: textX + (optRtl ? 0 : 14), y, width: textW - 14, size: 10.5, rtl: optRtl });
        });
      }
      doc.y = y + 6;
      doc.x = PAGE_LEFT;
    });
  });
}

function noticePdf({ schoolName, logoPath, title, category, message, createdAt, stampPath }) {
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName, logoPath, subtitle: 'Notice', badge: category });
    doc.font('Helvetica-Bold').fontSize(14).text(title);
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(new Date(createdAt || Date.now()).toLocaleString());
    doc.fillColor('#000');
    doc.moveDown();
    doc.font('Helvetica').fontSize(11).text(message, { align: 'left' });
    if (stampPath) {
      doc.moveDown(1);
      if (doc.y > 700) doc.addPage();
      drawStamp(doc, stampPath, PAGE_RIGHT - 60, doc.y + 42, 84);
    }
  });
}

// Student ID cards, laid out CR80-size (3.375in x 2.125in, standard card
// size) 2-up x 4-up on an A4 sheet — cut-and-laminate for a class set, or
// print a single card by passing a 1-item array. `cards`: [{ student, qrBuffer,
// photoPath }], where photoPath is an absolute on-disk path or null.
const CARD_WIDTH = 243;
const CARD_HEIGHT = 153;
const CARD_GUTTER_X = 20;
const CARD_GUTTER_Y = 14;
const CARDS_PER_ROW = 2;
const CARDS_PER_COL = 4;
const CARDS_PER_PAGE = CARDS_PER_ROW * CARDS_PER_COL;

function drawIdCard(doc, x, y, { schoolName, logoPath, student, qrBuffer, photoPath, session }) {
  doc.roundedRect(x, y, CARD_WIDTH, CARD_HEIGHT, 8).lineWidth(1).strokeColor('#c7ccd6').stroke().strokeColor('#000');
  doc.roundedRect(x, y, CARD_WIDTH, 30, 8).fill(BRAND_COLOR);
  doc.rect(x, y + 15, CARD_WIDTH, 15).fill(BRAND_COLOR); // square off the bottom corners of the header band

  const hasLogo = logoPath && fs.existsSync(logoPath);
  if (hasLogo) {
    try { doc.image(logoPath, x + 6, y + 5, { fit: [20, 20] }); } catch { /* skip a corrupt logo file */ }
  }
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9.5)
    .text(schoolName, x + (hasLogo ? 30 : 8), y + 10, { width: CARD_WIDTH - (hasLogo ? 36 : 14), align: hasLogo ? 'left' : 'center' });
  doc.fillColor('#000');

  const photoBoxX = x + 10;
  const photoBoxY = y + 38;
  const photoBoxW = 62;
  const photoBoxH = 74;
  doc.rect(photoBoxX, photoBoxY, photoBoxW, photoBoxH).strokeColor('#c7ccd6').stroke().strokeColor('#000');
  if (photoPath && fs.existsSync(photoPath)) {
    try { doc.image(photoPath, photoBoxX, photoBoxY, { fit: [photoBoxW, photoBoxH], align: 'center', valign: 'center' }); } catch { /* skip unreadable photo */ }
  } else {
    doc.fontSize(7).fillColor('#999').text('PHOTO', photoBoxX, photoBoxY + photoBoxH / 2 - 4, { width: photoBoxW, align: 'center' });
    doc.fillColor('#000');
  }

  const infoX = photoBoxX + photoBoxW + 10;
  const infoWidth = x + CARD_WIDTH - infoX - 60;
  let infoY = y + 40;
  doc.font('Helvetica-Bold').fontSize(10).text(student.full_name, infoX, infoY, { width: infoWidth });
  infoY = doc.y + 3;
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  doc.text(`${student.class_name || '-'} - ${student.section_name || '-'}`, infoX, infoY, { width: infoWidth }); infoY = doc.y + 2;
  doc.text(`Roll No: ${student.roll_number ?? '-'}`, infoX, infoY, { width: infoWidth }); infoY = doc.y + 1.5;
  doc.text(`ID: ${student.student_code}`, infoX, infoY, { width: infoWidth }); infoY = doc.y + 1.5;
  if (student.admission_number) { doc.text(`Adm No: ${student.admission_number}`, infoX, infoY, { width: infoWidth }); infoY = doc.y + 1.5; }
  if (session) { doc.text(`Session: ${session}`, infoX, infoY, { width: infoWidth }); infoY = doc.y + 1.5; }
  if (student.blood_group) { doc.text(`Blood Group: ${student.blood_group}`, infoX, infoY, { width: infoWidth }); }
  doc.fillColor('#000');

  if (qrBuffer) {
    const qrSize = 50;
    try { doc.image(qrBuffer, x + CARD_WIDTH - qrSize - 8, y + CARD_HEIGHT - qrSize - 8, { fit: [qrSize, qrSize] }); } catch { /* skip */ }
  }
  doc.font('Helvetica').fontSize(6).fillColor('#888')
    .text('If found, please return to the school office.', x + 6, y + CARD_HEIGHT - 10, { width: CARD_WIDTH - 12, align: 'center' });
  doc.fillColor('#000');
}

function studentIdCardsPdf({ schoolName, logoPath, cards, session }) {
  return new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: 30, size: 'A4' }));
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    cards.forEach((card, index) => {
      const posInPage = index % CARDS_PER_PAGE;
      if (index > 0 && posInPage === 0) doc.addPage();
      const col = posInPage % CARDS_PER_ROW;
      const row = Math.floor(posInPage / CARDS_PER_ROW);
      const x = doc.page.margins.left + col * (CARD_WIDTH + CARD_GUTTER_X);
      const y = doc.page.margins.top + row * (CARD_HEIGHT + CARD_GUTTER_Y);
      drawIdCard(doc, x, y, { schoolName, logoPath, session, ...card });
    });

    doc.end();
  });
}

// Teacher / staff ID card: same CR80 size and 8-up sheet as the student card,
// with a coloured role strip (TEACHER / STAFF). card: { person: { name,
// father_name, designation, code, phone, joined }, role, qrBuffer, photoPath }
function drawEmployeeCard(doc, x, y, { schoolName, logoPath, person, role, qrBuffer, photoPath, session }) {
  const roleColor = role === 'TEACHER' ? '#047857' : '#7c3aed';
  doc.roundedRect(x, y, CARD_WIDTH, CARD_HEIGHT, 8).lineWidth(1).strokeColor('#c7ccd6').stroke().strokeColor('#000');
  doc.roundedRect(x, y, CARD_WIDTH, 30, 8).fill(BRAND_COLOR);
  doc.rect(x, y + 15, CARD_WIDTH, 15).fill(BRAND_COLOR);
  const hasLogo = logoPath && fs.existsSync(logoPath);
  if (hasLogo) {
    try { doc.image(logoPath, x + 6, y + 5, { fit: [20, 20] }); } catch { /* skip a corrupt logo file */ }
  }
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9.5)
    .text(schoolName, x + (hasLogo ? 30 : 8), y + 10, { width: CARD_WIDTH - (hasLogo ? 36 : 14), align: hasLogo ? 'left' : 'center', lineBreak: false, ellipsis: true });

  // role strip down the left edge of the photo
  const photoBoxX = x + 10;
  const photoBoxY = y + 38;
  const photoBoxW = 62;
  const photoBoxH = 74;
  doc.rect(photoBoxX, photoBoxY, photoBoxW, photoBoxH).strokeColor('#c7ccd6').stroke().strokeColor('#000');
  if (photoPath && fs.existsSync(photoPath)) {
    try { doc.image(photoPath, photoBoxX, photoBoxY, { fit: [photoBoxW, photoBoxH], align: 'center', valign: 'center' }); } catch { /* skip unreadable photo */ }
  } else {
    doc.fontSize(7).fillColor('#999').text('PHOTO', photoBoxX, photoBoxY + photoBoxH / 2 - 4, { width: photoBoxW, align: 'center' });
  }
  doc.rect(photoBoxX, photoBoxY + photoBoxH + 3, photoBoxW, 13).fill(roleColor);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5).text(role, photoBoxX, photoBoxY + photoBoxH + 6, { width: photoBoxW, align: 'center' });

  const infoX = photoBoxX + photoBoxW + 10;
  const infoWidth = x + CARD_WIDTH - infoX - 8;
  let infoY = y + 38;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(person.name, infoX, infoY, { width: infoWidth });
  infoY = doc.y + 1;
  if (person.designation) { doc.font('Helvetica-Bold').fontSize(8).fillColor(roleColor).text(person.designation, infoX, infoY, { width: infoWidth }); infoY = doc.y + 2; }
  doc.font('Helvetica').fontSize(7.8).fillColor('#333');
  const lines = [
    person.father_name && `Father: ${person.father_name}`,
    `ID: ${person.code}`,
    person.phone && `Phone: ${person.phone}`,
    person.joined && `Joined: ${person.joined}`,
    session && `Session: ${session}`
  ].filter(Boolean);
  const textWidth = infoWidth - (qrBuffer ? 46 : 0);
  lines.forEach((l) => { doc.text(l, infoX, infoY, { width: textWidth }); infoY = doc.y + 1.2; });
  if (qrBuffer) {
    try { doc.image(qrBuffer, x + CARD_WIDTH - 50, y + CARD_HEIGHT - 52, { fit: [42, 42] }); } catch { /* skip */ }
  }
  doc.font('Helvetica').fontSize(6).fillColor('#888')
    .text('If found, please return to the school office.', x + 6, y + CARD_HEIGHT - 10, { width: CARD_WIDTH - 12, align: 'center' });
  doc.fillColor('#000');
}

function employeeIdCardsPdf({ schoolName, logoPath, cards, session }) {
  return new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: 30, size: 'A4' }));
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    cards.forEach((card, index) => {
      const posInPage = index % CARDS_PER_PAGE;
      if (index > 0 && posInPage === 0) doc.addPage();
      const col = posInPage % CARDS_PER_ROW;
      const row = Math.floor(posInPage / CARDS_PER_ROW);
      const x = doc.page.margins.left + col * (CARD_WIDTH + CARD_GUTTER_X);
      const y = doc.page.margins.top + row * (CARD_HEIGHT + CARD_GUTTER_Y);
      drawEmployeeCard(doc, x, y, { schoolName, logoPath, session, ...card });
    });
    if (!cards.length) doc.font('Helvetica').fontSize(12).text('No one to print.');
    doc.end();
  });
}

// Column widths follow the content: names get room, small numbers stay narrow.
function fitColumns(doc, columns, rows) {
  const sample = rows.slice(0, 300);
  const want = columns.map((c) => {
    if (c.width) return c.width;
    doc.font('Helvetica').fontSize(9.5);
    const longest = Math.max(
      doc.font('Helvetica-Bold').fontSize(9).widthOfString(String(c.label)),
      ...sample.map((r) => doc.font('Helvetica').fontSize(9.5).widthOfString(String(r[c.key] ?? '')))
    );
    return Math.min(Math.max(longest + 14, 42), 230);
  });
  // Columns with a set width keep it; the others share what is left.
  const fixed = columns.reduce((s, c) => s + (c.width || 0), 0);
  const flexWant = want.reduce((s, w, i) => s + (columns[i].width ? 0 : w), 0) || 1;
  const room = Math.max(PAGE_WIDTH - fixed, 60);
  const numberish = (v) => v === null || v === undefined || v === '' || v === '-' || /^-?\d+(\.\d+)?%?$/.test(String(v));
  return columns.map((c, i) => ({
    ...c,
    width: c.width || (want[i] / flexWant) * room,
    // counts, amounts and % sit in the middle of their column
    align: c.align || (sample.length && sample.every((r) => numberish(r[c.key])) ? 'center' : undefined)
  }));
}

function tableReportPdf({ title, columns, rows, subtitle }) {
  let branding = { schoolName: 'School Report', logoPath: null };
  try {
    const { getDb } = require('../db/connection');
    branding = require('./settings').getBranding(getDb());
  } catch { /* no database (e.g. a unit test) */ }
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName: branding.schoolName, logoPath: branding.logoPath, subtitle: title });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const printed = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (subtitle) doc.font('Helvetica-Bold').fontSize(10).fillColor('#333').text(subtitle, PAGE_LEFT, doc.y - 4, { width: PAGE_WIDTH, align: 'left' });
    doc.font('Helvetica').fontSize(8).fillColor('#666').text(`Printed ${printed} · ${rows.length} row(s)`, PAGE_LEFT, subtitle ? doc.y - 11 : doc.y - 6, { width: PAGE_WIDTH, align: 'right' }).fillColor('#000');
    doc.moveDown(0.5);
    // Wide reports (10+ columns) use a slightly smaller font so every header fits.
    drawTable(doc, { columns: fitColumns(doc, columns, rows), rows, fontSize: columns.length >= 10 ? 8.5 : 9.5 });
  });
}

module.exports = { drawMixed, drawHeader, drawInfoGrid, drawTable, drawPrintedSignatures, drawStamp, PAGE_LEFT, PAGE_RIGHT, PAGE_WIDTH, BRAND_COLOR, renderPdf, sendPdf, receiptPdf, invoicePdf, payslipPdf, examPaperPdf, noticePdf, tableReportPdf, studentIdCardsPdf, employeeIdCardsPdf };
