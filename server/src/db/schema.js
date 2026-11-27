// Full normalized schema for the School Management System.
// Statements are idempotent (CREATE TABLE/INDEX IF NOT EXISTS) so this can run on every boot.

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    capacity INTEGER DEFAULT 40
  )`,

  `CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 40,
    room_id INTEGER REFERENCES rooms(id),
    class_teacher_id INTEGER REFERENCES teachers(id),
    UNIQUE(class_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id),
    teacher_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    gender TEXT,
    date_of_birth TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    qualification TEXT,
    designation TEXT,
    employment_type TEXT DEFAULT 'Full-time',
    hire_date TEXT DEFAULT (date('now')),
    status TEXT NOT NULL DEFAULT 'Active',
    photo_path TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS class_subject_teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    UNIQUE(section_id, subject_id)
  )`,

  `CREATE TABLE IF NOT EXISTS parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id),
    full_name TEXT NOT NULL,
    relation TEXT DEFAULT 'Guardian',
    phone TEXT,
    email TEXT,
    occupation TEXT,
    address TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id),
    student_code TEXT UNIQUE NOT NULL,
    admission_number TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    gender TEXT,
    date_of_birth TEXT,
    blood_group TEXT,
    section_id INTEGER REFERENCES sections(id),
    roll_number INTEGER,
    parent_id INTEGER REFERENCES parents(id),
    secondary_parent_id INTEGER REFERENCES parents(id),
    address TEXT,
    admission_date TEXT DEFAULT (date('now')),
    status TEXT NOT NULL DEFAULT 'Active',
    photo_path TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS student_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    doc_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS student_promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    from_section_id INTEGER REFERENCES sections(id),
    to_section_id INTEGER REFERENCES sections(id),
    academic_year_from TEXT,
    academic_year_to TEXT,
    promoted_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    promoted_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS teacher_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    leave_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS timetable_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    day_of_week INTEGER NOT NULL,
    period_id INTEGER NOT NULL REFERENCES periods(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    room_id INTEGER REFERENCES rooms(id),
    UNIQUE(section_id, day_of_week, period_id)
  )`,

  `CREATE TABLE IF NOT EXISTS student_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    section_id INTEGER NOT NULL REFERENCES sections(id),
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL,
    marked_by INTEGER REFERENCES users(id),
    marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    corrected_by INTEGER REFERENCES users(id),
    corrected_at TEXT,
    remarks TEXT,
    UNIQUE(student_id, attendance_date)
  )`,

  `CREATE TABLE IF NOT EXISTS teacher_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    corrected_by INTEGER REFERENCES users(id),
    corrected_at TEXT,
    UNIQUE(teacher_id, attendance_date)
  )`,

  `CREATE TABLE IF NOT EXISTS question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    class_id INTEGER REFERENCES classes(id),
    chapter TEXT,
    topic TEXT,
    difficulty TEXT NOT NULL DEFAULT 'Medium',
    marks INTEGER NOT NULL DEFAULT 1,
    question_type TEXT NOT NULL,
    question_text TEXT NOT NULL,
    options_json TEXT,
    correct_answer TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS exam_papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    class_id INTEGER REFERENCES classes(id),
    subject_id INTEGER REFERENCES subjects(id),
    term TEXT,
    total_marks INTEGER NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    instructions TEXT,
    scheduled_date TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS exam_paper_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_paper_id INTEGER NOT NULL REFERENCES exam_papers(id),
    question_id INTEGER NOT NULL REFERENCES question_bank(id),
    marks_override INTEGER,
    order_index INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS fee_heads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS fee_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
    amount REAL NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'Monthly',
    academic_year TEXT NOT NULL,
    UNIQUE(class_id, fee_head_id, academic_year)
  )`,

  `CREATE TABLE IF NOT EXISTS student_fee_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    fee_head_id INTEGER REFERENCES fee_heads(id),
    discount_type TEXT NOT NULL DEFAULT 'Fixed',
    value REAL NOT NULL,
    reason TEXT,
    approved_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS fee_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    invoice_number TEXT UNIQUE NOT NULL,
    period_label TEXT NOT NULL,
    due_date TEXT NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    fine_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS fee_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id),
    fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
    amount REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS fee_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id),
    receipt_number TEXT UNIQUE NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    payment_date TEXT NOT NULL DEFAULT (date('now')),
    received_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS payroll_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER UNIQUE NOT NULL REFERENCES teachers(id),
    basic_salary REAL NOT NULL DEFAULT 0,
    allowances_json TEXT NOT NULL DEFAULT '[]',
    deductions_json TEXT NOT NULL DEFAULT '[]',
    effective_from TEXT NOT NULL DEFAULT (date('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS salary_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    amount REAL NOT NULL,
    reason TEXT,
    taken_on TEXT NOT NULL DEFAULT (date('now')),
    recovery_per_month REAL NOT NULL,
    remaining_balance REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active'
  )`,

  `CREATE TABLE IF NOT EXISTS payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    basic REAL NOT NULL,
    total_allowances REAL NOT NULL DEFAULT 0,
    total_deductions REAL NOT NULL DEFAULT 0,
    advance_deduction REAL NOT NULL DEFAULT 0,
    net_salary REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    payslip_number TEXT UNIQUE NOT NULL,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    UNIQUE(teacher_id, month, year)
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Announcement',
    audience_type TEXT NOT NULL DEFAULT 'All',
    audience_ref TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS notification_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL REFERENCES notifications(id),
    channel TEXT NOT NULL,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    sent_at TEXT,
    error TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS backups_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    size_bytes INTEGER,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,

  // Backs human-readable sequential codes (student/admission/teacher/invoice/
  // receipt/payslip numbers) with an O(1) atomic increment instead of the
  // O(n) `SELECT COUNT(*)` scan this used to require on every single call —
  // that turned bulk operations (e.g. generating invoices for a whole class)
  // into O(n^2). See server/src/utils/ids.js.
  `CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id, archived)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_students_roll_active ON students(section_id, roll_number) WHERE archived = 0 AND roll_number IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_students_search ON students(full_name, student_code, admission_number)`,
  `CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers(status, archived)`,
  `CREATE INDEX IF NOT EXISTS idx_student_attendance_date ON student_attendance(attendance_date, section_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teacher_attendance_date ON teacher_attendance(attendance_date)`,
  `CREATE INDEX IF NOT EXISTS idx_question_bank_lookup ON question_bank(subject_id, class_id, difficulty, archived)`,
  `CREATE INDEX IF NOT EXISTS idx_fee_invoices_student ON fee_invoices(student_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_fee_payments_invoice ON fee_payments(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payroll_runs_teacher ON payroll_runs(teacher_id, year, month)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_timetable_lookup ON timetable_entries(section_id, day_of_week)`,
  // Added for hot-path joins that were previously unindexed (dashboard/report queries,
  // bulk invoice generation, notification fan-out) — CREATE INDEX IF NOT EXISTS is safe
  // to add here directly (unlike CREATE TABLE, it applies retroactively to existing
  // tables on every boot, so upgrading installs pick these up automatically).
  `CREATE INDEX IF NOT EXISTS idx_notification_recipients_notification ON notification_recipients(notification_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fee_invoice_items_invoice ON fee_invoice_items(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_student_documents_student ON student_documents(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teacher_leaves_teacher ON teacher_leaves(teacher_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_class_subject_teachers_teacher ON class_subject_teachers(teacher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exam_paper_questions_paper ON exam_paper_questions(exam_paper_id)`,
  `CREATE INDEX IF NOT EXISTS idx_student_fee_discounts_student ON student_fee_discounts(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fee_structures_class_year ON fee_structures(class_id, academic_year)`,
  `CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_id)`
];

function ensureSchema(db) {
  for (const statement of STATEMENTS) {
    db.exec(statement);
  }
}

module.exports = { ensureSchema };
