-- School Management System — Database Schema
-- Generated from server/src/db/schema.js — this is the single source of truth.
-- Engine: SQLite (Node built-in node:sqlite). Regenerate by re-running this dump after schema changes.

CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE backups_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    size_bytes INTEGER,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE class_subject_teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    UNIQUE(section_id, subject_id)
  );

CREATE TABLE classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE exam_paper_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_paper_id INTEGER NOT NULL REFERENCES exam_papers(id),
    question_id INTEGER NOT NULL REFERENCES question_bank(id),
    marks_override INTEGER,
    order_index INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE exam_papers (
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
  );

CREATE TABLE fee_heads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

CREATE TABLE fee_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id),
    fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
    amount REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0
  );

CREATE TABLE fee_invoices (
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
  );

CREATE TABLE fee_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id),
    receipt_number TEXT UNIQUE NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    payment_date TEXT NOT NULL DEFAULT (date('now')),
    received_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE fee_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
    amount REAL NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'Monthly',
    academic_year TEXT NOT NULL,
    UNIQUE(class_id, fee_head_id, academic_year)
  );

CREATE TABLE notification_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL REFERENCES notifications(id),
    channel TEXT NOT NULL,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    sent_at TEXT,
    error TEXT
  );

CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Announcement',
    audience_type TEXT NOT NULL DEFAULT 'All',
    audience_ref TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id),
    full_name TEXT NOT NULL,
    relation TEXT DEFAULT 'Guardian',
    phone TEXT,
    email TEXT,
    occupation TEXT,
    address TEXT
  );

CREATE TABLE payroll_runs (
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
  );

CREATE TABLE payroll_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER UNIQUE NOT NULL REFERENCES teachers(id),
    basic_salary REAL NOT NULL DEFAULT 0,
    allowances_json TEXT NOT NULL DEFAULT '[]',
    deductions_json TEXT NOT NULL DEFAULT '[]',
    effective_from TEXT NOT NULL DEFAULT (date('now'))
  );

CREATE TABLE periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE question_bank (
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
  );

CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    capacity INTEGER DEFAULT 40
  );

CREATE TABLE salary_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    amount REAL NOT NULL,
    reason TEXT,
    taken_on TEXT NOT NULL DEFAULT (date('now')),
    recovery_per_month REAL NOT NULL,
    remaining_balance REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active'
  );

CREATE TABLE sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 40,
    room_id INTEGER REFERENCES rooms(id),
    class_teacher_id INTEGER REFERENCES teachers(id),
    UNIQUE(class_id, name)
  );

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

CREATE TABLE sqlite_sequence(name,seq);

CREATE TABLE student_attendance (
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
  );

CREATE TABLE student_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    doc_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE student_fee_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    fee_head_id INTEGER REFERENCES fee_heads(id),
    discount_type TEXT NOT NULL DEFAULT 'Fixed',
    value REAL NOT NULL,
    reason TEXT,
    approved_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE student_promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    from_section_id INTEGER REFERENCES sections(id),
    to_section_id INTEGER REFERENCES sections(id),
    academic_year_from TEXT,
    academic_year_to TEXT,
    promoted_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    promoted_by INTEGER REFERENCES users(id)
  );

CREATE TABLE students (
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
  );

CREATE TABLE subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT
  );

CREATE TABLE teacher_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    corrected_by INTEGER REFERENCES users(id),
    corrected_at TEXT,
    UNIQUE(teacher_id, attendance_date)
  );

CREATE TABLE teacher_leaves (
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
  );

CREATE TABLE teachers (
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
  );

CREATE TABLE timetable_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    day_of_week INTEGER NOT NULL,
    period_id INTEGER NOT NULL REFERENCES periods(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    room_id INTEGER REFERENCES rooms(id),
    UNIQUE(section_id, day_of_week, period_id)
  );

CREATE TABLE users (
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
  );

CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

CREATE INDEX idx_fee_invoices_student ON fee_invoices(student_id, status);

CREATE INDEX idx_fee_payments_invoice ON fee_payments(invoice_id);

CREATE INDEX idx_payroll_runs_teacher ON payroll_runs(teacher_id, year, month);

CREATE INDEX idx_question_bank_lookup ON question_bank(subject_id, class_id, difficulty, archived);

CREATE INDEX idx_student_attendance_date ON student_attendance(attendance_date, section_id);

CREATE UNIQUE INDEX idx_students_roll_active ON students(section_id, roll_number) WHERE archived = 0 AND roll_number IS NOT NULL;

CREATE INDEX idx_students_search ON students(full_name, student_code, admission_number);

CREATE INDEX idx_students_section ON students(section_id, archived);

CREATE INDEX idx_teacher_attendance_date ON teacher_attendance(attendance_date);

CREATE INDEX idx_teachers_status ON teachers(status, archived);

CREATE INDEX idx_timetable_lookup ON timetable_entries(section_id, day_of_week);
