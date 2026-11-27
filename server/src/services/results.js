// Marks, grades and results — shared by the progress-report and result-card
// endpoints and their PDFs.
const { getSetting } = require('./settings');

const ASSESSMENT_KINDS = ['Daily Test', 'Weekly Test', 'Monthly Test', 'Quarterly Exam', 'Half-Yearly Exam', 'Annual Exam', 'Other'];
const TERM_KINDS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Annual', 'Other'];

const DEFAULT_SCALE = [
  { min: 90, grade: 'A+', remark: 'Outstanding' },
  { min: 80, grade: 'A', remark: 'Excellent' },
  { min: 70, grade: 'B', remark: 'Very Good' },
  { min: 60, grade: 'C', remark: 'Good' },
  { min: 50, grade: 'D', remark: 'Satisfactory' },
  { min: 33, grade: 'E', remark: 'Needs Improvement' },
  { min: 0, grade: 'F', remark: 'Fail' }
];

function getGrading(db) {
  let scale = DEFAULT_SCALE;
  try {
    const raw = JSON.parse(getSetting(db, 'grading_scale', '') || 'null');
    if (Array.isArray(raw) && raw.length) scale = raw;
  } catch { /* keep default */ }
  scale = [...scale].map((s) => ({ min: Number(s.min) || 0, grade: String(s.grade || ''), remark: String(s.remark || '') })).sort((a, b) => b.min - a.min);
  const pass = Number(getSetting(db, 'pass_percentage', '33'));
  return { scale, pass_percentage: Number.isFinite(pass) ? pass : 33 };
}

function gradeFor(grading, pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return { grade: '-', remark: '' };
  const row = grading.scale.find((s) => pct >= s.min) || grading.scale[grading.scale.length - 1];
  return { grade: row ? row.grade : '-', remark: row ? row.remark : '' };
}

const round1 = (n) => Math.round(n * 10) / 10;
const pctOf = (obtained, total) => (total > 0 ? round1((obtained / total) * 100) : null);

// Students on a section's roll on a date: current students plus anyone who
// left after that date, plus anyone who already has marks in the given
// assessments (e.g. promoted since).
function sectionRoster(db, sectionId, onDate, assessmentIds = []) {
  const rows = db.prepare(
    `SELECT s.id, s.full_name, s.student_code, s.admission_number, s.roll_number, s.parent_id, s.photo_path, s.section_id
     FROM students s
     WHERE s.archived = 0 AND s.section_id = @section
       AND (s.status NOT IN ('Left', 'Graduated') OR (s.left_on IS NOT NULL AND s.left_on > @date))`
  ).all({ section: sectionId, date: onDate });
  if (assessmentIds.length) {
    const have = new Set(rows.map((r) => r.id));
    const extra = db.prepare(
      `SELECT DISTINCT s.id, s.full_name, s.student_code, s.admission_number, s.roll_number, s.parent_id, s.photo_path, s.section_id
       FROM assessment_marks am JOIN students s ON s.id = am.student_id
       WHERE am.assessment_id IN (${assessmentIds.map(() => '?').join(',')})`
    ).all(...assessmentIds);
    extra.forEach((r) => { if (!have.has(r.id)) rows.push(r); });
  }
  rows.sort((a, b) => (a.roll_number ?? 1e9) - (b.roll_number ?? 1e9) || a.full_name.localeCompare(b.full_name));
  return rows;
}

// Every assessment result for one student in a date range.
function studentProgress(db, studentId, { from, to, kind } = {}) {
  const grading = getGrading(db);
  const rows = db.prepare(
    `SELECT a.id, a.kind, a.title, a.held_on, a.total_marks, a.pass_marks, a.subject_id, sub.name AS subject_name,
            am.obtained, am.absent, am.remarks, t.name AS term_name
     FROM assessments a
     JOIN assessment_marks am ON am.assessment_id = a.id AND am.student_id = @student
     JOIN subjects sub ON sub.id = a.subject_id
     LEFT JOIN exam_terms t ON t.id = a.term_id
     WHERE a.archived = 0
       AND (@from = '' OR a.held_on >= @from) AND (@to = '' OR a.held_on <= @to)
       AND (@kind = '' OR a.kind = @kind)
       AND (am.obtained IS NOT NULL OR am.absent = 1)
     ORDER BY a.held_on, sub.name, a.id`
  ).all({ student: studentId, from: from || '', to: to || '', kind: kind || '' });

  const items = rows.map((r) => {
    const pct = r.absent ? null : pctOf(r.obtained, r.total_marks);
    return { ...r, percentage: pct, ...gradeFor(grading, pct) };
  });

  const bySubject = new Map();
  for (const r of items) {
    const s = bySubject.get(r.subject_id) || { subject_id: r.subject_id, subject_name: r.subject_name, tests: 0, absent: 0, obtained: 0, total: 0, best: null, worst: null };
    s.tests += 1;
    if (r.absent) s.absent += 1;
    else {
      s.obtained += r.obtained;
      s.total += r.total_marks;
      s.best = s.best === null ? r.percentage : Math.max(s.best, r.percentage);
      s.worst = s.worst === null ? r.percentage : Math.min(s.worst, r.percentage);
    }
    bySubject.set(r.subject_id, s);
  }
  const subjects = [...bySubject.values()].map((s) => {
    const pct = pctOf(s.obtained, s.total);
    return { ...s, obtained: round1(s.obtained), percentage: pct, ...gradeFor(grading, pct) };
  }).sort((a, b) => a.subject_name.localeCompare(b.subject_name));

  const months = new Map();
  for (const r of items) {
    if (r.absent) continue;
    const m = r.held_on.slice(0, 7);
    const v = months.get(m) || { month: m, obtained: 0, total: 0 };
    v.obtained += r.obtained;
    v.total += r.total_marks;
    months.set(m, v);
  }
  const trend = [...months.values()].map((m) => ({ month: m.month, percentage: pctOf(m.obtained, m.total) }));

  const obtained = items.filter((r) => !r.absent).reduce((s, r) => s + r.obtained, 0);
  const total = items.filter((r) => !r.absent).reduce((s, r) => s + r.total_marks, 0);
  const pct = pctOf(obtained, total);
  return {
    items,
    subjects,
    trend,
    overall: { tests: items.length, absent: items.filter((r) => r.absent).length, obtained: round1(obtained), total, percentage: pct, ...gradeFor(grading, pct) },
    grading
  };
}

// Result sheet for a term and section: per student, per subject totals,
// percentage, grade, pass/fail and class position.
function termResults(db, termId, sectionId) {
  const grading = getGrading(db);
  const term = db.prepare('SELECT * FROM exam_terms WHERE id = ?').get(termId);
  if (!term) return null;
  const section = db.prepare(
    `SELECT sec.id, sec.name AS section_name, c.name AS class_name, t.full_name AS class_teacher_name
     FROM sections sec JOIN classes c ON c.id = sec.class_id LEFT JOIN teachers t ON t.id = sec.class_teacher_id WHERE sec.id = ?`
  ).get(sectionId);
  if (!section) return null;
  const assessments = db.prepare(
    `SELECT a.*, sub.name AS subject_name FROM assessments a JOIN subjects sub ON sub.id = a.subject_id
     WHERE a.archived = 0 AND a.term_id = ? AND a.section_id = ? ORDER BY sub.name, a.held_on, a.id`
  ).all(termId, sectionId);

  const subjectMap = new Map();
  for (const a of assessments) {
    const s = subjectMap.get(a.subject_id) || { subject_id: a.subject_id, subject_name: a.subject_name, total: 0, pass_marks: 0, allPass: true, assessment_ids: [] };
    s.total += a.total_marks;
    if (a.pass_marks === null || a.pass_marks === undefined) s.allPass = false;
    else s.pass_marks += a.pass_marks;
    s.assessment_ids.push(a.id);
    subjectMap.set(a.subject_id, s);
  }
  const subjects = [...subjectMap.values()].map((s) => ({
    subject_id: s.subject_id,
    subject_name: s.subject_name,
    total: s.total,
    pass_marks: s.allPass ? s.pass_marks : Math.round((s.total * grading.pass_percentage) / 100 * 10) / 10,
    assessment_ids: s.assessment_ids
  }));

  const ids = assessments.map((a) => a.id);
  const lastDate = assessments.reduce((m, a) => (a.held_on > m ? a.held_on : m), term.end_date || term.start_date || '0000-00-00');
  const roster = sectionRoster(db, sectionId, lastDate, ids);
  const marks = ids.length
    ? db.prepare(`SELECT * FROM assessment_marks WHERE assessment_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const markKey = new Map(marks.map((m) => [`${m.assessment_id}:${m.student_id}`, m]));
  const remarks = new Map(db.prepare('SELECT * FROM result_remarks WHERE term_id = ?').all(termId).map((r) => [r.student_id, r]));

  const students = roster.map((st) => {
    const subj = {};
    let obtained = 0;
    let total = 0;
    let entered = 0;
    const failed = [];
    for (const s of subjects) {
      let o = 0;
      let any = false;
      let allAbsent = true;
      for (const aid of s.assessment_ids) {
        const m = markKey.get(`${aid}:${st.id}`);
        if (m && m.obtained !== null && !m.absent) { o += m.obtained; any = true; allAbsent = false; }
        else if (!(m && m.absent)) allAbsent = false;
      }
      const absent = !any && allAbsent && s.assessment_ids.some((aid) => markKey.get(`${aid}:${st.id}`)?.absent);
      if (any || absent) entered += 1;
      const pct = any ? pctOf(o, s.total) : null;
      const pass = any && o >= s.pass_marks;
      if (!pass) failed.push(s.subject_name);
      obtained += o;
      total += s.total;
      subj[s.subject_id] = { obtained: any ? round1(o) : null, absent, total: s.total, percentage: pct, pass, ...gradeFor(grading, pct) };
    }
    const pct = pctOf(obtained, total);
    const complete = subjects.length > 0 && entered === subjects.length;
    const pass = complete && failed.length === 0 && pct !== null && pct >= grading.pass_percentage;
    const r = remarks.get(st.id) || {};
    return {
      student_id: st.id,
      full_name: st.full_name,
      student_code: st.student_code,
      admission_number: st.admission_number,
      roll_number: st.roll_number,
      parent_id: st.parent_id,
      photo_path: st.photo_path,
      subjects: subj,
      obtained: round1(obtained),
      total,
      percentage: pct,
      ...gradeFor(grading, pct),
      complete,
      status: !complete ? 'Incomplete' : (pass ? 'Pass' : 'Fail'),
      failed_subjects: complete ? failed : [],
      teacher_remarks: r.teacher_remarks || '',
      principal_remarks: r.principal_remarks || ''
    };
  });

  // Class position by percentage (ties share a position).
  const ranked = students.filter((s) => s.complete && s.percentage !== null).sort((a, b) => b.percentage - a.percentage);
  let lastPct = null;
  let lastPos = 0;
  ranked.forEach((s, i) => {
    if (s.percentage !== lastPct) { lastPos = i + 1; lastPct = s.percentage; }
    s.position = lastPos;
  });

  const approval = db.prepare('SELECT * FROM result_approvals WHERE term_id = ? AND section_id = ?').get(termId, sectionId) || null;
  const passed = students.filter((s) => s.status === 'Pass').length;
  return {
    term,
    section,
    subjects: subjects.map(({ assessment_ids, ...s }) => ({ ...s, assessments: assessment_ids.length })),
    students,
    approval,
    grading,
    stats: { students: students.length, passed, failed: students.filter((s) => s.status === 'Fail').length, incomplete: students.filter((s) => s.status === 'Incomplete').length, out_of: ranked.length }
  };
}

module.exports = { ASSESSMENT_KINDS, TERM_KINDS, DEFAULT_SCALE, getGrading, gradeFor, sectionRoster, studentProgress, termResults, pctOf };
