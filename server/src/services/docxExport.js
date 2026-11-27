const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const { hasUrdu, isRtl } = require('./pdfText');

const URDU_OPTION_LABELS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و'];
const URDU_FONT = 'Jameel Noori Nastaleeq';

// A paragraph that reads right-to-left in Word (Urdu), or a normal one.
function para(runs, rtl, extra = {}) {
  return new Paragraph({
    ...extra,
    bidirectional: rtl,
    alignment: extra.alignment || (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
    children: runs.map((r) => new TextRun({ ...r, rightToLeft: rtl && hasUrdu(r.text), font: hasUrdu(r.text) ? { name: 'Arial', cs: URDU_FONT } : r.font, size: hasUrdu(r.text) ? 26 : r.size }))
  });
}

async function examPaperDocx({ schoolName, paper, questions }) {
  const children = [
    new Paragraph({ text: schoolName, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    hasUrdu(paper.title) ? para([{ text: paper.title, bold: true }], true, { alignment: AlignmentType.CENTER }) : new Paragraph({ text: paper.title, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }),
    new Paragraph({
      children: [new TextRun(`Class: ${paper.class_name || '-'}    Subject: ${paper.subject_name || '-'}    Term: ${paper.term || '-'}`)]
    }),
    new Paragraph({
      children: [new TextRun(`Total Marks: ${questions.reduce((t, q) => t + Number(q.marks_override || q.marks || 0), 0) || paper.total_marks}    Duration: ${paper.duration_minutes} minutes`)]
    }),
    new Paragraph({ text: '' })
  ];

  if (paper.instructions) {
    children.push(hasUrdu(paper.instructions) ? para([{ text: paper.instructions, italics: true }], isRtl(paper.instructions)) : new Paragraph({ children: [new TextRun({ text: `Instructions: ${paper.instructions}`, italics: true })] }));
    children.push(new Paragraph({ text: '' }));
  }

  questions.forEach((q, idx) => {
    const marks = q.marks_override || q.marks;
    const rtl = isRtl(q.question_text);
    children.push(para([
      { text: rtl ? `${idx + 1}. ` : `Q${idx + 1}. `, bold: true },
      { text: q.question_text },
      { text: `  [${marks} marks]`, italics: true }
    ], rtl));
    if (q.question_type === 'MCQ' && q.options_json) {
      let options = [];
      try { options = JSON.parse(q.options_json) || []; } catch { options = []; }
      options.forEach((opt, i) => {
        const optRtl = rtl || isRtl(opt);
        const label = optRtl ? `(${URDU_OPTION_LABELS[i] || i + 1}) ` : `${String.fromCharCode(97 + i)}) `;
        children.push(para([{ text: label }, { text: opt }], optRtl, { indent: optRtl ? { right: 400 } : { left: 400 } }));
      });
    }
    children.push(new Paragraph({ text: '' }));
  });

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

module.exports = { examPaperDocx };
