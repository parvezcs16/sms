// What a teacher teaches: class-teacher sections (any subject) and the
// section+subject pairs they are assigned to.
function teacherSectionIds(db, teacherId) {
  if (!teacherId) return new Set();
  return new Set(db.prepare(
    `SELECT id FROM sections WHERE class_teacher_id = @t
     UNION SELECT section_id FROM class_subject_teachers WHERE teacher_id = @t`
  ).all({ t: teacherId }).map((r) => r.id));
}

function teacherTeaches(db, teacherId, sectionId, subjectId) {
  if (!teacherId) return false;
  if (db.prepare('SELECT id FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, teacherId)) return true;
  return Boolean(db.prepare('SELECT id FROM class_subject_teachers WHERE section_id = ? AND subject_id = ? AND teacher_id = ?').get(sectionId, subjectId, teacherId));
}

// Any section of the class, for class-level records like the syllabus.
function teacherTeachesClass(db, teacherId, classId, subjectId) {
  if (!teacherId) return false;
  const secs = db.prepare('SELECT id FROM sections WHERE class_id = ?').all(classId);
  return secs.some((s) => teacherTeaches(db, teacherId, s.id, subjectId));
}

// Sections whose homework / calendar a parent or student may see.
function familySectionIds(db, user) {
  if (user.role === 'student') {
    const s = db.prepare('SELECT section_id FROM students WHERE user_id = ?').get(user.id);
    return s && s.section_id ? [s.section_id] : [];
  }
  if (user.role === 'parent') {
    const p = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(user.id);
    if (!p) return [];
    return db.prepare(`SELECT DISTINCT section_id FROM students WHERE (parent_id = @p OR secondary_parent_id = @p)
      AND archived = 0 AND status NOT IN ('Left', 'Graduated') AND section_id IS NOT NULL`).all({ p: p.id }).map((r) => r.section_id);
  }
  return [];
}

module.exports = { teacherSectionIds, teacherTeaches, teacherTeachesClass, familySectionIds };
