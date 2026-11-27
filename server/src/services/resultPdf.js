// Printable progress reports and result cards (A4, school letterhead).
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { dmyDoc } = require('../utils/dmy');
const {
  drawMixed, drawHeader, drawTable, drawPrintedSignatures, renderPdf, PAGE_LEFT, PAGE_RIGHT, PAGE_WIDTH, BRAND_COLOR
} = require('./pdf');

const f1 = (n) => (n === null || n === undefined ? '-' : (Math.round(n * 10) / 10).toString());
const pctTxt = (n) => (n === null || n === undefined ? '-' : `${f1(n)}%`);
const fmtTime = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 16) : '');

// Key/value lines on the left and a photo box on the right.
function drawStudentBlock(doc, pairs, photoPath) {
  const top = doc.y;
  const photoW = 72;
  const photoH = 86;
  const colW = (PAGE_WIDTH - photoW - 16) / 2;
  const rowH = 20;
  doc.lineWidth(0.75).strokeColor('#c7ccd6');
  pairs.forEach((pair, i) => {
    pair.forEach(([label, value], col) => {
      const x = PAGE_LEFT + col * colW;
      const y = top + i * rowH;
      doc.rect(x, y, colW, rowH).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#555').text(label.toUpperCase(), x + 5, y + 6.5, { width: 78, lineBreak: false });
      doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(String(value ?? '-'), x + 84, y + 5.5, { width: colW - 88, lineBreak: false, ellipsis: true });
    });
  });
  const px = PAGE_RIGHT - photoW;
  doc.rect(px, top, photoW, photoH).stroke();
  if (photoPath && fs.existsSync(photoPath)) {
    try { doc.image(photoPath, px + 2, top + 2, { fit: [photoW - 4, photoH - 4], align: 'center', valign: 'center' }); } catch { /* unreadable photo */ }
  } else {
    doc.font('Helvetica').fontSize(7).fillColor('#999').text('PHOTO', px, top + photoH / 2 - 4, { width: photoW, align: 'center' });
  }
  doc.strokeColor('#000').fillColor('#000');
  doc.x = PAGE_LEFT;
  doc.y = top + Math.max(pairs.length * rowH, photoH) + 12;
}

// A row of highlighted summary boxes: [{ label, value, color }]
function drawSummaryBoxes(doc, boxes) {
  const y = doc.y;
  const gap = 8;
  const w = (PAGE_WIDTH - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((b, i) => {
    const x = PAGE_LEFT + i * (w + gap);
    doc.roundedRect(x, y, w, 40, 4).fillAndStroke('#f3f6fd', '#c7d2f0');
    doc.fillColor('#555').font('Helvetica').fontSize(7.5).text(b.label.toUpperCase(), x, y + 6, { width: w, align: 'center' });
    doc.fillColor(b.color || '#111').font('Helvetica-Bold').fontSize(13).text(String(b.value), x, y + 19, { width: w, align: 'center' });
  });
  doc.fillColor('#000');
  doc.x = PAGE_LEFT;
  doc.y = y + 52;
}

function drawRemarks(doc, label, text) {
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#333').text(label, PAGE_LEFT, doc.y);
  const top = doc.y + 2;
  doc.fillColor('#000');
  const y = drawMixed(doc, text || '—', { x: PAGE_LEFT + 6, y: top + 4, width: PAGE_WIDTH - 12, size: 10 });
  doc.rect(PAGE_LEFT, top, PAGE_WIDTH, Math.max(26, y - top + 2)).lineWidth(0.6).strokeColor('#c7ccd6').stroke().strokeColor('#000');
  doc.y = Math.max(top + 26, y + 2) + 8;
  doc.x = PAGE_LEFT;
}

function drawGradeKey(doc, grading) {
  const parts = grading.scale.map((s) => `${s.grade} ${s.min}%+`).join('   ');
  doc.font('Helvetica').fontSize(7.5).fillColor('#666')
    .text(`Grades: ${parts}   ·   Pass mark: ${grading.pass_percentage}% overall and in each subject`, PAGE_LEFT, doc.y, { width: PAGE_WIDTH });
  doc.fillColor('#000');
  doc.moveDown(0.6);
}

function drawResultCard(doc, { schoolName, logoPath, session, data, student, photoPath, stampPath }) {
  const { term, section, subjects, approval, grading, stats } = data;
  const badge = student.status === 'Pass' ? 'PASS' : student.status === 'Fail' ? 'FAIL' : 'INCOMPLETE';
  drawHeader(doc, { schoolName, logoPath, subtitle: `Result Card — ${term.name}`, badge });
  drawStudentBlock(doc, [
    [['Student', student.full_name], ['Roll No', student.roll_number ?? '-']],
    [['Class', `${section.class_name} - ${section.section_name}`], ['Admission No', student.admission_number || '-']],
    [['Student ID', student.student_code], ['Session', term.session || session || '-']],
    [['Exam', `${term.kind}${term.end_date ? ` · ${term.end_date}` : ''}`], ['Class Teacher', section.class_teacher_name || '-']]
  ], photoPath);

  const rows = subjects.map((s, i) => {
    const r = student.subjects[s.subject_id] || {};
    return {
      sr: i + 1,
      subject: s.subject_name,
      total: f1(s.total),
      pass: f1(s.pass_marks),
      obtained: r.absent ? 'Absent' : f1(r.obtained),
      pct: pctTxt(r.percentage),
      grade: r.grade || '-',
      result: r.obtained === null || r.obtained === undefined ? (r.absent ? 'Fail' : '-') : (r.pass ? 'Pass' : 'Fail')
    };
  });
  rows.push({ sr: '', subject: 'TOTAL', total: f1(student.total), pass: '', obtained: f1(student.obtained), pct: pctTxt(student.percentage), grade: student.grade, result: student.status });
  drawTable(doc, {
    columns: [
      { key: 'sr', label: '#', width: 26, align: 'center' },
      { key: 'subject', label: 'Subject', width: 155 },
      { key: 'total', label: 'Total', width: 52, align: 'right' },
      { key: 'pass', label: 'Pass Marks', width: 62, align: 'right' },
      { key: 'obtained', label: 'Obtained', width: 62, align: 'right' },
      { key: 'pct', label: '%', width: 55, align: 'right' },
      { key: 'grade', label: 'Grade', width: 48, align: 'center' },
      { key: 'result', label: 'Result', width: 55, align: 'center' }
    ],
    rows,
    zebra: true
  });

  drawSummaryBoxes(doc, [
    { label: 'Marks', value: `${f1(student.obtained)} / ${f1(student.total)}` },
    { label: 'Percentage', value: pctTxt(student.percentage) },
    { label: 'Grade', value: student.grade },
    { label: 'Result', value: student.status, color: student.status === 'Pass' ? '#15803d' : student.status === 'Fail' ? '#b91c1c' : '#92400e' },
    { label: 'Position', value: student.position ? `${student.position} of ${stats.out_of}` : '-' }
  ]);
  if (student.status === 'Fail' && student.failed_subjects.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#b91c1c').text(`Needs to improve in: ${student.failed_subjects.join(', ')}`, PAGE_LEFT, doc.y);
    doc.fillColor('#000').moveDown(0.5);
  }
  drawGradeKey(doc, grading);
  drawRemarks(doc, "Class Teacher's Remarks", student.teacher_remarks);
  drawRemarks(doc, "Principal's Remarks", student.principal_remarks);

  drawPrintedSignatures(doc, [
    { caption: 'Class Teacher', name: section.class_teacher_name },
    { caption: approval ? 'Approved By' : 'Principal', name: approval && approval.approved_by_name, detail: approval ? [approval.approved_by_designation, fmtTime(approval.approved_at)].filter(Boolean).join(' · ') : '' },
    { caption: 'Parent / Guardian' }
  ], stampPath);
}

// One A4 page per student. `students`: the rows from termResults to print.
function resultCardsPdf({ schoolName, logoPath, session, data, students, photoPathFor, stampPath }) {
  return new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: 40, size: 'A4' }));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    students.forEach((st, i) => {
      if (i > 0) doc.addPage();
      drawResultCard(doc, { schoolName, logoPath, session, data, student: st, photoPath: photoPathFor(st), stampPath });
    });
    doc.end();
  });
}

function progressReportPdf({ schoolName, logoPath, student, periodLabel, kind, report, preparedBy, stampPath }) {
  return renderPdf((doc) => {
    drawHeader(doc, { schoolName, logoPath, subtitle: 'Student Progress Report', badge: periodLabel });
    drawStudentBlock(doc, [
      [['Student', student.full_name], ['Roll No', student.roll_number ?? '-']],
      [['Class', student.class_label || '-'], ['Student ID', student.student_code]],
      [['Period', periodLabel], ['Tests', kind || 'All tests & exams']],
      [['Parent', student.parent_name || '-'], ['Phone', student.parent_phone || '-']]
    ], student.photoPath);

    const o = report.overall;
    drawSummaryBoxes(doc, [
      { label: 'Tests / Exams', value: o.tests },
      { label: 'Marks', value: `${f1(o.obtained)} / ${f1(o.total)}` },
      { label: 'Average', value: pctTxt(o.percentage) },
      { label: 'Grade', value: o.grade },
      { label: 'Absent', value: o.absent, color: o.absent ? '#b91c1c' : '#111' }
    ]);

    if (!report.items.length) {
      doc.font('Helvetica').fontSize(11).fillColor('#555').text('No marks have been entered for this period yet.', PAGE_LEFT, doc.y);
      doc.fillColor('#000');
      return;
    }

    doc.font('Helvetica-Bold').fontSize(11).text('Subject Summary', PAGE_LEFT, doc.y);
    doc.moveDown(0.3);
    drawTable(doc, {
      columns: [
        { key: 'subject', label: 'Subject', width: 150 },
        { key: 'tests', label: 'Tests', width: 45, align: 'center' },
        { key: 'marks', label: 'Marks', width: 90, align: 'right' },
        { key: 'pct', label: 'Average', width: 60, align: 'right' },
        { key: 'grade', label: 'Grade', width: 45, align: 'center' },
        { key: 'best', label: 'Best', width: 60, align: 'right' },
        { key: 'worst', label: 'Lowest', width: 65, align: 'right' }
      ],
      rows: report.subjects.map((s) => ({
        subject: s.subject_name, tests: s.tests, marks: `${f1(s.obtained)} / ${f1(s.total)}`, pct: pctTxt(s.percentage), grade: s.grade, best: pctTxt(s.best), worst: pctTxt(s.worst)
      }))
    });

    if (report.trend.length > 1) {
      doc.font('Helvetica-Bold').fontSize(11).text('Month by Month', PAGE_LEFT, doc.y);
      doc.moveDown(0.4);
      const barMax = PAGE_WIDTH - 140;
      report.trend.forEach((m) => {
        if (doc.y > 760) doc.addPage();
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#333').text(m.month, PAGE_LEFT, y + 2, { width: 70 });
        const w = Math.max(2, (barMax * (m.percentage || 0)) / 100);
        doc.rect(PAGE_LEFT + 72, y + 2, barMax, 10).fill('#eef2f9');
        doc.rect(PAGE_LEFT + 72, y + 2, w, 10).fill(BRAND_COLOR);
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(9).text(pctTxt(m.percentage), PAGE_LEFT + 80 + barMax, y + 2, { width: 60 });
        doc.y = y + 16;
      });
      doc.x = PAGE_LEFT;
      doc.moveDown(0.6);
    }

    doc.font('Helvetica-Bold').fontSize(11).text('All Tests', PAGE_LEFT, doc.y);
    doc.moveDown(0.3);
    drawTable(doc, {
      columns: [
        { key: 'date', label: 'Date', width: 65 },
        { key: 'kind', label: 'Type', width: 80 },
        { key: 'title', label: 'Test', width: 125 },
        { key: 'subject', label: 'Subject', width: 90 },
        { key: 'marks', label: 'Marks', width: 60, align: 'right' },
        { key: 'pct', label: '%', width: 50, align: 'right' },
        { key: 'grade', label: 'Grade', width: 45, align: 'center' }
      ],
      rows: report.items.map((r) => ({
        date: r.held_on, kind: r.kind, title: r.title, subject: r.subject_name,
        marks: r.absent ? 'Absent' : `${f1(r.obtained)}/${f1(r.total_marks)}`, pct: pctTxt(r.percentage), grade: r.absent ? '-' : r.grade
      }))
    });
    drawGradeKey(doc, report.grading);
    drawPrintedSignatures(doc, [
      { caption: 'Prepared By', name: preparedBy && preparedBy.name, detail: preparedBy ? [preparedBy.designation, fmtTime(preparedBy.at)].filter(Boolean).join(' · ') : '' },
      { caption: 'Principal' },
      { caption: 'Parent / Guardian' }
    ], stampPath);
  });
}

module.exports = { resultCardsPdf, progressReportPdf };
