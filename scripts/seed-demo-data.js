// Populates the database with realistic demo data for exploring the app:
// classes KG through XII (1-2 sections each, picked at random the first time),
// ~20 teachers and ~100 students with Pakistani names, timetable assignments,
// a fee structure, and a handful of question-bank entries.
//
// Safe to re-run: existing classes/sections/teachers/students are detected and
// left alone rather than duplicated.
//
// Run with: node scripts/seed-demo-data.js  (or `npm run seed:demo` from server/)
const path = require('path');
process.env.SMS_DATA_DIR = process.env.SMS_DATA_DIR || path.join(__dirname, '..', '.data');

const bcrypt = require('bcryptjs');
const { getDb } = require('../server/src/db/connection');
const { ensureSchema } = require('../server/src/db/schema');
const { runMigrations } = require('../server/src/db/migrations');
const { ensureSeed } = require('../server/src/db/seed');
const ids = require('../server/src/utils/ids');

const db = getDb();
ensureSchema(db);
runMigrations(db);
ensureSeed(db);

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickUnique(arr, used) {
  let value = pick(arr);
  let attempts = 0;
  while (used.has(value) && attempts < 20) { value = pick(arr); attempts += 1; }
  used.add(value);
  return value;
}

const MALE_FIRST_NAMES = [
  'Muhammad Ali', 'Ahmed', 'Hassan', 'Hussain', 'Bilal', 'Usman', 'Umar', 'Ibrahim', 'Zain', 'Talha',
  'Hamza', 'Fahad', 'Adeel', 'Kashif', 'Imran', 'Tariq', 'Waqas', 'Asad', 'Faisal', 'Junaid',
  'Saad', 'Rizwan', 'Shahzad', 'Naveed', 'Arslan', 'Danish', 'Farhan', 'Salman', 'Yasir', 'Zeeshan',
  'Abdullah', 'Ayaan', 'Haris', 'Rayyan', 'Shayan'
];
const FEMALE_FIRST_NAMES = [
  'Ayesha', 'Fatima', 'Zainab', 'Sana', 'Hira', 'Mehwish', 'Sadia', 'Amna', 'Rabia', 'Maria',
  'Iqra', 'Sobia', 'Nida', 'Farah', 'Saba', 'Bushra', 'Uzma', 'Rukhsana', 'Shazia', 'Kiran',
  'Anum', 'Mahnoor', 'Areeba', 'Laiba', 'Noor', 'Sara', 'Aiman', 'Komal', 'Tehmina', 'Yusra',
  'Eman', 'Alishba', 'Zoya', 'Hafsa', 'Warda'
];
const LAST_NAMES = [
  'Khan', 'Ahmed', 'Ali', 'Malik', 'Sheikh', 'Raza', 'Iqbal', 'Farooq', 'Butt', 'Chaudhry',
  'Hussain', 'Abbasi', 'Mirza', 'Qureshi', 'Baig', 'Awan', 'Gill', 'Rana', 'Siddiqui', 'Bhatti',
  'Warraich', 'Chishti', 'Soomro', 'Baloch', 'Khokhar', 'Cheema'
];

function randomFullName() {
  const isFemale = Math.random() < 0.5;
  const first = pick(isFemale ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return { fullName: `${first} ${last}`, gender: isFemale ? 'Female' : 'Male' };
}

function upsertLookup(table, col, value, extra = {}) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE ${col} = ?`).get(value);
  if (existing) return existing.id;
  const keys = [col, ...Object.keys(extra)];
  const values = [value, ...Object.values(extra)];
  const result = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...values);
  return Number(result.lastInsertRowid);
}

console.log('Seeding demo data (KG - XII, ~20 teachers, ~100 students)...');

// ---- Subjects ----
const subjectNames = ['English', 'Urdu', 'Mathematics', 'Science', 'Social Studies', 'Islamiyat', 'Computer Science'];
const subjectIds = subjectNames.map((name) => upsertLookup('subjects', 'name', name));

// ---- Rooms ----
const roomIds = Array.from({ length: 10 }, (_, i) => upsertLookup('rooms', 'name', `Room ${101 + i}`, { capacity: 40 }));

// ---- Classes KG..XII with 1-2 random sections each ----
const CLASS_NAMES = ['KG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'];
const classSections = []; // { classId, sectionId, className, sectionName }

CLASS_NAMES.forEach((name, idx) => {
  const classId = upsertLookup('classes', 'name', name, { sort_order: idx });
  const existingSections = db.prepare('SELECT id, name FROM sections WHERE class_id = ?').all(classId);
  if (existingSections.length > 0) {
    existingSections.forEach((s) => classSections.push({ classId, sectionId: s.id, className: name, sectionName: s.name }));
    return;
  }
  const sectionCount = Math.random() < 0.5 ? 1 : 2;
  const sectionNames = sectionCount === 1 ? ['A'] : ['A', 'B'];
  sectionNames.forEach((sectionName) => {
    const roomId = pick(roomIds);
    const result = db.prepare('INSERT INTO sections (class_id, name, capacity, room_id) VALUES (?, ?, ?, ?)').run(classId, sectionName, 35, roomId);
    classSections.push({ classId, sectionId: Number(result.lastInsertRowid), className: name, sectionName });
  });
});

// ---- ~20 Teachers with logins ----
const teacherRoleId = db.prepare('SELECT id FROM roles WHERE name = ?').get('teacher').id;
const DESIGNATIONS = ['Subject Teacher', 'Senior Teacher', 'Head of Department', 'Coordinator'];
const usedTeacherNames = new Set();
const TEACHER_COUNT = 20;
const teacherIds = [];

for (let i = 0; i < TEACHER_COUNT; i += 1) {
  let full_name; let gender;
  do { ({ fullName: full_name, gender } = randomFullName()); } while (usedTeacherNames.has(full_name));
  usedTeacherNames.add(full_name);

  const existing = db.prepare('SELECT id FROM teachers WHERE full_name = ?').get(full_name);
  if (existing) { teacherIds.push(existing.id); continue; }

  const username = `${full_name.toLowerCase().replace(/\s+/g, '.')}${i}`;
  const passwordHash = bcrypt.hashSync('Teacher@123', 10);
  const userResult = db.prepare(
    'INSERT INTO users (username, password_hash, role_id, full_name, email, must_change_password) VALUES (?, ?, ?, ?, ?, 1)'
  ).run(username, passwordHash, teacherRoleId, full_name, `${username}@school.local`);
  const code = ids.teacherCode(db);
  const result = db.prepare(
    `INSERT INTO teachers (user_id, teacher_code, full_name, gender, email, phone, designation, qualification, hire_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'))`
  ).run(Number(userResult.lastInsertRowid), code, full_name, gender, `${username}@school.local`, `030${String(10000000 + i).slice(0, 8)}`, pick(DESIGNATIONS), 'B.Ed, M.A');
  teacherIds.push(Number(result.lastInsertRowid));
}

// ---- Assign a class teacher + 3 subject teachers to every section ----
classSections.forEach((sec, idx) => {
  db.prepare('UPDATE sections SET class_teacher_id = COALESCE(class_teacher_id, ?) WHERE id = ?').run(teacherIds[idx % teacherIds.length], sec.sectionId);
  const sectionSubjects = subjectIds.slice(0, 4);
  sectionSubjects.forEach((subjectId, sIdx) => {
    const teacherId = teacherIds[(idx + sIdx) % teacherIds.length];
    const exists = db.prepare('SELECT id FROM class_subject_teachers WHERE section_id = ? AND subject_id = ?').get(sec.sectionId, subjectId);
    if (!exists) db.prepare('INSERT INTO class_subject_teachers (section_id, subject_id, teacher_id) VALUES (?, ?, ?)').run(sec.sectionId, subjectId, teacherId);
  });
});

// ---- ~100 Students with parents, spread across all sections ----
const STUDENT_TOTAL = 100;
const perSection = Math.max(1, Math.round(STUDENT_TOTAL / classSections.length));
let studentsCreated = 0;
const usedStudentNames = new Set();

classSections.forEach((sec) => {
  const existingCount = db.prepare('SELECT COUNT(*) AS c FROM students WHERE section_id = ?').get(sec.sectionId).c;
  const toCreate = Math.max(0, perSection - existingCount);
  for (let roll = existingCount + 1; roll <= existingCount + toCreate; roll += 1) {
    if (studentsCreated >= STUDENT_TOTAL) break;
    const { fullName, gender } = randomFullName();
    const key = `${fullName}-${sec.sectionId}`;
    if (usedStudentNames.has(key)) continue;
    usedStudentNames.add(key);

    const { fullName: guardianName } = randomFullName();
    const parentResult = db.prepare(
      'INSERT INTO parents (full_name, relation, phone, email) VALUES (?, ?, ?, ?)'
    ).run(guardianName, pick(['Father', 'Mother', 'Guardian']), `03${String(100000000 + studentsCreated).slice(0, 9)}`, null);

    const code = ids.studentCode(db);
    const admissionNo = ids.admissionNumber(db);
    db.prepare(
      `INSERT INTO students (student_code, admission_number, full_name, gender, section_id, roll_number, parent_id, admission_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, date('now'))`
    ).run(code, admissionNo, fullName, gender, sec.sectionId, roll, Number(parentResult.lastInsertRowid));
    studentsCreated += 1;
  }
});

// ---- Fee heads + a simple per-class structure ----
const feeHeadIds = { Tuition: upsertLookup('fee_heads', 'name', 'Tuition'), Transport: upsertLookup('fee_heads', 'name', 'Transport') };
const year = String(new Date().getFullYear());
classSections.forEach((sec) => {
  db.prepare(
    `INSERT INTO fee_structures (class_id, fee_head_id, amount, frequency, academic_year) VALUES (?, ?, ?, 'Monthly', ?)
     ON CONFLICT(class_id, fee_head_id, academic_year) DO NOTHING`
  ).run(sec.classId, feeHeadIds.Tuition, 2000 + sec.classId * 150, year);
});

// ---- A handful of question bank entries ----
const sampleQuestions = [
  { subject: 'Mathematics', text: 'What is the value of pi (to 2 decimal places)?', type: 'Short', marks: 2 },
  { subject: 'Mathematics', text: 'Solve: 12 x 8 = ?', type: 'Short', marks: 1 },
  { subject: 'Science', text: 'What gas do plants absorb from the atmosphere?', type: 'Short', marks: 2 },
  { subject: 'English', text: 'Identify the noun in: "The dog ran fast."', type: 'Short', marks: 1 },
  { subject: 'Urdu', text: 'اسم اور فعل میں فرق بتائیں۔', type: 'Short', marks: 2 },
  { subject: 'Islamiyat', text: 'Name the first Kalima.', type: 'Short', marks: 2 }
];
sampleQuestions.forEach((q) => {
  const subjectId = subjectIds[subjectNames.indexOf(q.subject)];
  db.prepare(
    `INSERT INTO question_bank (subject_id, chapter, difficulty, marks, question_type, question_text) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(subjectId, 'General', 'Medium', q.marks, q.type, q.text);
});

console.log(`Done. Classes: ${CLASS_NAMES.length} (KG-XII), sections: ${classSections.length}, teachers: ${teacherIds.length}, students added this run: ${studentsCreated}.`);
console.log('Teacher logins: <username printed above pattern> / Teacher@123 — see the users table, or reset a password from Settings.');
console.log('Admin login: admin / Admin@123');
