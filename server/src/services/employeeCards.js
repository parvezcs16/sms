// Printable ID cards for teachers and non-teaching staff (8 per A4 sheet).
const path = require('path');
const config = require('../config');
const pdfService = require('./pdf');
const qrService = require('./qrcode');
const { getBranding, getSetting } = require('./settings');

// kind: 'teacher' | 'staff'; ids: [] = everyone active.
async function employeeIdCards(db, kind, ids = []) {
  const idFilter = ids.length ? `AND t.id IN (${ids.map(Number).filter(Boolean).join(',') || 0})` : '';
  const rows = kind === 'teacher'
    ? db.prepare(`SELECT t.*, t.teacher_code AS code, t.designation AS role_name FROM teachers t
        WHERE t.archived = 0 AND t.status = 'Active' ${idFilter} ORDER BY t.full_name`).all()
    : db.prepare(`SELECT t.*, t.staff_code AS code, sc.name AS role_name FROM staff t JOIN staff_categories sc ON sc.id = t.category_id
        WHERE t.archived = 0 AND t.status = 'Active' ${idFilter} ORDER BY t.full_name`).all();
  const { schoolName, logoPath } = getBranding(db);
  const cards = await Promise.all(rows.map(async (r) => ({
    role: kind === 'teacher' ? 'TEACHER' : 'STAFF',
    person: { name: r.full_name, father_name: r.father_name, designation: r.role_name || (kind === 'teacher' ? 'Teacher' : ''), code: r.code, phone: r.phone, joined: r.hire_date },
    qrBuffer: await qrService.studentQrPngBuffer(r.code),
    photoPath: r.photo_path ? path.join(config.uploadsDir, r.photo_path) : null
  })));
  return { count: rows.length, buffer: await pdfService.employeeIdCardsPdf({ schoolName, logoPath, cards, session: getSetting(db, 'academic_year', '') }) };
}

module.exports = { employeeIdCards };
