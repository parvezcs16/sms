// Versioned, additive-only schema migrations.
//
// schema.js's CREATE TABLE IF NOT EXISTS statements only ever run for a table
// that doesn't exist yet — they do NOT retroactively add new columns to a table
// an already-installed school already has. So once a version has shipped, any
// further schema change (new column, new table, new index) must be added here
// as a new migration instead of editing schema.js's existing statements.
//
// Each migration runs at most once (tracked in schema_migrations) and must be
// additive/non-destructive — never DROP or rewrite a column that may hold real
// school data. This is what lets a school install an updated build of the app
// over an old one and keep their existing database untouched apart from these
// additive changes.
//
// To add a new migration in a future release:
//   1. Append a new { id: N, description, run(db) } entry (id = next integer).
//   2. Use `ALTER TABLE ... ADD COLUMN ...` / `CREATE TABLE IF NOT EXISTS ...` /
//      `CREATE INDEX IF NOT EXISTS ...` only. Never DROP TABLE/COLUMN here.
//   3. Never edit or renumber an existing migration once it has shipped.
function seedSequence(db, name, table) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  db.prepare(`INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`).run(name, row.c);
}

const MIGRATIONS = [
  {
    id: 1,
    description: 'Seed sequences table from existing row counts (switches code/number generation from O(n) COUNT(*) to O(1) atomic increment — this only matters for upgrades; fresh installs start clean at 0)',
    run(db) {
      seedSequence(db, 'students.student_code', 'students');
      seedSequence(db, 'students.admission_number', 'students');
      seedSequence(db, 'teachers.teacher_code', 'teachers');
      seedSequence(db, 'fee_invoices.invoice_number', 'fee_invoices');
      seedSequence(db, 'fee_payments.receipt_number', 'fee_payments');
      seedSequence(db, 'payroll_runs.payslip_number', 'payroll_runs');
    }
  },
  {
    id: 2,
    description: 'Non-teaching staff: categories, staff records, attendance, leave, payroll (mirrors the teacher tables, kept separate so nothing about teachers changes)',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS staff_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )`);
      const seedCategories = ['Peon', 'Sweeper', 'Security Guard', 'Tea Boy', 'Driver', 'Librarian', 'Lab Assistant', 'Clerk', 'Accounts Staff', 'Other Support Staff'];
      const insertCategory = db.prepare('INSERT OR IGNORE INTO staff_categories (name) VALUES (?)');
      seedCategories.forEach((name) => insertCategory.run(name));

      db.exec(`CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE REFERENCES users(id),
        staff_code TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        gender TEXT,
        date_of_birth TEXT,
        category_id INTEGER NOT NULL REFERENCES staff_categories(id),
        email TEXT,
        phone TEXT,
        address TEXT,
        employment_type TEXT DEFAULT 'Full-time',
        hire_date TEXT DEFAULT (date('now')),
        status TEXT NOT NULL DEFAULT 'Active',
        photo_path TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS staff_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL REFERENCES staff(id),
        attendance_date TEXT NOT NULL,
        status TEXT NOT NULL,
        marked_by INTEGER REFERENCES users(id),
        marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        corrected_by INTEGER REFERENCES users(id),
        corrected_at TEXT,
        remarks TEXT,
        UNIQUE(staff_id, attendance_date)
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS staff_leaves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL REFERENCES staff(id),
        leave_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'Pending',
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_by INTEGER REFERENCES users(id),
        decided_at TEXT
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS staff_payroll_structures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER UNIQUE NOT NULL REFERENCES staff(id),
        basic_salary REAL NOT NULL DEFAULT 0,
        allowances_json TEXT NOT NULL DEFAULT '[]',
        deductions_json TEXT NOT NULL DEFAULT '[]',
        effective_from TEXT NOT NULL DEFAULT (date('now'))
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS staff_salary_advances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL REFERENCES staff(id),
        amount REAL NOT NULL,
        reason TEXT,
        taken_on TEXT NOT NULL DEFAULT (date('now')),
        recovery_per_month REAL NOT NULL,
        remaining_balance REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active'
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS staff_payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL REFERENCES staff(id),
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
        UNIQUE(staff_id, month, year)
      )`);

      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status, archived)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_category ON staff(category_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_leaves_staff ON staff_leaves(staff_id, status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_payroll_runs_staff ON staff_payroll_runs(staff_id, year, month)');
    }
  },
  {
    id: 3,
    description: 'Daily expenses: categories + expense records',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )`);
      const seedCategories = ['Utilities', 'Maintenance & Repairs', 'Supplies & Stationery', 'Transport & Fuel', 'Salaries (Cash)', 'Events & Activities', 'Furniture & Equipment', 'Miscellaneous'];
      const insertCategory = db.prepare('INSERT OR IGNORE INTO expense_categories (name) VALUES (?)');
      seedCategories.forEach((name) => insertCategory.run(name));

      db.exec(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_number TEXT UNIQUE NOT NULL,
        category_id INTEGER NOT NULL REFERENCES expense_categories(id),
        expense_date TEXT NOT NULL DEFAULT (date('now')),
        amount REAL NOT NULL,
        paid_to TEXT,
        payment_method TEXT NOT NULL DEFAULT 'Cash',
        notes TEXT,
        receipt_path TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id)');
    }
  },
  {
    id: 4,
    description: 'Link fee invoices to a single fee head and/or exam paper when generated for a specific purpose (e.g. an exam fee voucher), instead of always covering every fee head for the class',
    run(db) {
      db.exec(`ALTER TABLE fee_invoices ADD COLUMN fee_head_id INTEGER REFERENCES fee_heads(id)`);
      db.exec(`ALTER TABLE fee_invoices ADD COLUMN related_exam_paper_id INTEGER REFERENCES exam_papers(id)`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_fee_invoices_exam_paper ON fee_invoices(related_exam_paper_id)');
    }
  },
  {
    id: 5,
    description: 'Teacher attendance remarks (bulk teacher attendance marked by Principal / Super Admin) + lookup index',
    run(db) {
      if (!hasColumn(db, 'teacher_attendance', 'remarks')) {
        db.exec('ALTER TABLE teacher_attendance ADD COLUMN remarks TEXT');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_teacher_attendance_teacher ON teacher_attendance(teacher_id, attendance_date)');
    }
  },
  {
    id: 6,
    description: 'Student updated_at for edits (older databases may predate it)',
    run(db) {
      if (!hasColumn(db, 'students', 'updated_at')) {
        db.exec('ALTER TABLE students ADD COLUMN updated_at TEXT');
      }
      if (!hasColumn(db, 'teachers', 'updated_at')) {
        db.exec('ALTER TABLE teachers ADD COLUMN updated_at TEXT');
      }
    }
  },
  {
    id: 7,
    description: 'Editable finance records: invoice cancellation + edit tracking, payment voiding (records are corrected, never silently deleted)',
    run(db) {
      const add = (table, column, type) => {
        if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      };
      add('fee_invoices', 'updated_at', 'TEXT');
      add('fee_invoices', 'cancelled_at', 'TEXT');
      add('fee_invoices', 'cancelled_by', 'INTEGER REFERENCES users(id)');
      add('fee_invoices', 'cancel_reason', 'TEXT');
      add('fee_payments', 'voided_at', 'TEXT');
      add('fee_payments', 'voided_by', 'INTEGER REFERENCES users(id)');
      add('fee_payments', 'void_reason', 'TEXT');
      add('staff', 'updated_at', 'TEXT');
      add('payroll_runs', 'remarks', 'TEXT');
      add('staff_payroll_runs', 'remarks', 'TEXT');
    }
  },
  {
    id: 8,
    description: 'Expenses are never erased: deleting marks them deleted (with who/when/why) so wrong entries stay traceable',
    run(db) {
      if (!hasColumn(db, 'expenses', 'deleted_at')) db.exec('ALTER TABLE expenses ADD COLUMN deleted_at TEXT');
      if (!hasColumn(db, 'expenses', 'deleted_by')) db.exec('ALTER TABLE expenses ADD COLUMN deleted_by INTEGER REFERENCES users(id)');
      if (!hasColumn(db, 'expenses', 'delete_reason')) db.exec('ALTER TABLE expenses ADD COLUMN delete_reason TEXT');
      if (!hasColumn(db, 'expenses', 'updated_at')) db.exec('ALTER TABLE expenses ADD COLUMN updated_at TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)');
    }
  },
  {
    id: 9,
    description: 'Archived user accounts + employee relieve / re-join (with employment history and salary at each step)',
    run(db) {
      const add = (table, column, type) => {
        if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      };
      add('users', 'archived_at', 'TEXT');
      add('users', 'archived_by', 'INTEGER REFERENCES users(id)');
      add('teachers', 'relieved_on', 'TEXT');
      add('teachers', 'relieve_reason', 'TEXT');
      add('staff', 'relieved_on', 'TEXT');
      add('staff', 'relieve_reason', 'TEXT');
      db.exec(`CREATE TABLE IF NOT EXISTS employment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_type TEXT NOT NULL,
        person_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        event_date TEXT NOT NULL,
        reason TEXT,
        salary_before REAL,
        salary_after REAL,
        details_json TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_employment_history_person ON employment_history(person_type, person_id)');
    }
  },
  {
    id: 10,
    description: 'Per-user permissions: management can give any user view / manage access to individual areas (classes, fees, payroll…)',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS user_permissions (
        user_id INTEGER NOT NULL REFERENCES users(id),
        module TEXT NOT NULL,
        level TEXT NOT NULL,
        granted_by INTEGER REFERENCES users(id),
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, module)
      )`);
    }
  },
  {
    id: 11,
    description: 'Students can leave school (transfer / moved) with a leaving date; staff can check in their own attendance',
    run(db) {
      const add = (table, column, type) => { if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); };
      add('students', 'left_on', 'TEXT');
      add('students', 'leaving_type', 'TEXT');
      add('students', 'leaving_reason', 'TEXT');
      add('staff_attendance', 'source', "TEXT NOT NULL DEFAULT 'manual'");
      db.exec('CREATE INDEX IF NOT EXISTS idx_students_status ON students(status, archived)');
    }
  },
  {
    id: 12,
    description: 'Payment trail (mode, who paid / received, exact time, approval & verification) and student marks, progress reports and result cards',
    run(db) {
      const add = (table, column, type) => { if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); };
      for (const t of ['payroll_runs', 'staff_payroll_runs']) {
        add(t, 'payment_mode', 'TEXT');
        add(t, 'payment_reference', 'TEXT');
        add(t, 'paid_by', 'INTEGER REFERENCES users(id)');
        add(t, 'paid_by_name', 'TEXT');
        add(t, 'approved_by', 'INTEGER REFERENCES users(id)');
        add(t, 'approved_by_name', 'TEXT');
        add(t, 'approved_by_designation', 'TEXT');
        add(t, 'approved_at', 'TEXT');
      }
      add('fee_payments', 'recorded_at', 'TEXT');
      add('fee_payments', 'received_by_name', 'TEXT');
      add('fee_payments', 'payment_reference', 'TEXT');
      add('fee_payments', 'verified_by', 'INTEGER REFERENCES users(id)');
      add('fee_payments', 'verified_by_name', 'TEXT');
      add('fee_payments', 'verified_by_designation', 'TEXT');
      add('fee_payments', 'verified_at', 'TEXT');
      // Existing payments: keep their original save time (stored in UTC) as local time,
      // and remember who received them by name.
      db.exec(`UPDATE fee_payments SET recorded_at = datetime(created_at, 'localtime') WHERE recorded_at IS NULL`);
      db.exec(`UPDATE fee_payments SET received_by_name = (SELECT full_name FROM users WHERE users.id = fee_payments.received_by)
               WHERE received_by_name IS NULL AND received_by IS NOT NULL`);
      add('users', 'designation', 'TEXT');

      db.exec(`CREATE TABLE IF NOT EXISTS exam_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'Annual',
        session TEXT,
        start_date TEXT,
        end_date TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        section_id INTEGER NOT NULL REFERENCES sections(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        term_id INTEGER REFERENCES exam_terms(id),
        held_on TEXT NOT NULL,
        total_marks REAL NOT NULL,
        pass_marks REAL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS assessment_marks (
        assessment_id INTEGER NOT NULL REFERENCES assessments(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        obtained REAL,
        absent INTEGER NOT NULL DEFAULT 0,
        remarks TEXT,
        entered_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (assessment_id, student_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS result_remarks (
        term_id INTEGER NOT NULL REFERENCES exam_terms(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        teacher_remarks TEXT,
        principal_remarks TEXT,
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (term_id, student_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS result_approvals (
        term_id INTEGER NOT NULL REFERENCES exam_terms(id),
        section_id INTEGER NOT NULL REFERENCES sections(id),
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        approved_by_designation TEXT,
        approved_at TEXT NOT NULL,
        PRIMARY KEY (term_id, section_id)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_assessments_section ON assessments(section_id, held_on)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_assessments_term ON assessments(term_id, section_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_assessment_marks_student ON assessment_marks(student_id)');
    }
  },
  {
    id: 13,
    description: 'Admissions, homework & syllabus, date sheet, library, transport, inventory, events calendar and other income',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS admission_enquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL, gender TEXT, date_of_birth TEXT,
        class_id INTEGER REFERENCES classes(id),
        parent_name TEXT, parent_phone TEXT, parent_email TEXT, address TEXT,
        previous_school TEXT, source TEXT,
        status TEXT NOT NULL DEFAULT 'New',
        test_date TEXT, test_result TEXT, notes TEXT,
        student_id INTEGER REFERENCES students(id),
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS homework (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        title TEXT NOT NULL, details TEXT,
        assigned_on TEXT NOT NULL, due_date TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS syllabus_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        term TEXT, unit TEXT, topic TEXT NOT NULL,
        planned_from TEXT, planned_to TEXT,
        status TEXT NOT NULL DEFAULT 'Pending',
        completed_on TEXT, notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS exam_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term_id INTEGER REFERENCES exam_terms(id),
        class_id INTEGER NOT NULL REFERENCES classes(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        exam_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
        room TEXT, invigilator TEXT, notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS library_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_no TEXT, title TEXT NOT NULL, author TEXT, publisher TEXT, isbn TEXT,
        category TEXT, language TEXT, shelf TEXT,
        copies INTEGER NOT NULL DEFAULT 1, price REAL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS library_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL REFERENCES library_books(id),
        borrower_type TEXT NOT NULL, borrower_id INTEGER NOT NULL, borrower_name TEXT,
        issued_on TEXT NOT NULL, due_on TEXT NOT NULL, returned_on TEXT,
        fine REAL NOT NULL DEFAULT 0, notes TEXT,
        issued_by INTEGER REFERENCES users(id), returned_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS transport_vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_no TEXT NOT NULL, model TEXT, capacity INTEGER,
        driver_name TEXT, driver_phone TEXT, driver_license TEXT, conductor_name TEXT, conductor_phone TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS transport_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, vehicle_id INTEGER REFERENCES transport_vehicles(id),
        monthly_fee REAL NOT NULL DEFAULT 0, stops TEXT, morning_time TEXT, return_time TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS student_transport (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id),
        route_id INTEGER NOT NULL REFERENCES transport_routes(id),
        stop TEXT, monthly_fee REAL,
        start_date TEXT NOT NULL, end_date TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, category TEXT, unit TEXT DEFAULT 'pcs', location TEXT,
        quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, unit_cost REAL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS inventory_moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id),
        kind TEXT NOT NULL, quantity REAL NOT NULL, balance_after REAL NOT NULL,
        moved_on TEXT NOT NULL, party TEXT, notes TEXT,
        created_by INTEGER REFERENCES users(id), created_by_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, description TEXT,
        start_date TEXT NOT NULL, end_date TEXT, start_time TEXT,
        kind TEXT NOT NULL DEFAULT 'Event', audience TEXT NOT NULL DEFAULT 'All',
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS other_income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        income_date TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL,
        received_from TEXT, payment_method TEXT NOT NULL DEFAULT 'Cash', reference TEXT, notes TEXT,
        recorded_by INTEGER REFERENCES users(id), recorded_by_name TEXT,
        deleted_at TEXT, deleted_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_homework_section ON homework(section_id, assigned_on)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_exam_schedule_class ON exam_schedule(class_id, exam_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_library_issues_open ON library_issues(returned_on, book_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_student_transport ON student_transport(student_id, end_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_moves_item ON inventory_moves(item_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_other_income_date ON other_income(income_date)');
    }
  },
  {
    id: 14,
    description: 'Log of homework diary / syllabus shared on WhatsApp',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS share_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        ref TEXT NOT NULL,
        section_id INTEGER,
        to_parents INTEGER NOT NULL DEFAULT 0,
        to_group TEXT,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        simulated INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_share_log_ref ON share_log(kind, ref)');
    }
  },
  {
    id: 15,
    description: 'Common fee heads (Tuition, Admission, Exam, Transport, Library, Fine, Late Fee, Trip, Annual, Sports, Computer Lab, Miscellaneous)',
    run(db) {
      require('../utils/feeHeads').seedCommonHeads(db);
    }
  },
  {
    id: 16,
    description: 'Profile photo for user accounts',
    run(db) {
      if (!hasColumn(db, 'users', 'photo')) db.exec('ALTER TABLE users ADD COLUMN photo TEXT');
    }
  },
  {
    id: 17,
    description: 'Certificates register (position, appreciation, participation, leaving, provisional, character)',
    run(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        certificate_number TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'classic',
        student_id INTEGER REFERENCES students(id),
        recipient_name TEXT NOT NULL,
        title TEXT,
        issue_date TEXT NOT NULL,
        data_json TEXT,
        issued_by INTEGER REFERENCES users(id),
        issued_by_name TEXT,
        created_at TEXT NOT NULL,
        cancelled_at TEXT,
        cancel_reason TEXT
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_certificates_student ON certificates(student_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_certificates_category ON certificates(category)');
    }
  },
  {
    id: 18,
    description: 'Father name for teachers & staff, more non-teaching designations, discount given while receiving a fee, and student fee advances',
    run(db) {
      const add = (t, c, def) => { if (!hasColumn(db, t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
      add('teachers', 'father_name', 'TEXT');
      add('staff', 'father_name', 'TEXT');
      const insertCategory = db.prepare('INSERT OR IGNORE INTO staff_categories (name) VALUES (?)');
      ['Admin', 'Accountant', 'Office Assistant', 'Security Guard', 'School Driver', 'Peon', 'Receptionist', 'Cleaner', 'IT Assistant', 'Store Keeper', 'Librarian Assistant']
        .forEach((n) => insertCategory.run(n));
      // Discount given at the counter: kept on the payment (so voiding it
      // undoes the discount) and summed on the invoice, which lowers total_amount.
      add('fee_payments', 'discount_amount', 'REAL NOT NULL DEFAULT 0');
      add('fee_invoices', 'concession_amount', 'REAL NOT NULL DEFAULT 0');
      // Money paid in advance: + when received, - when used on a new voucher.
      db.exec(`CREATE TABLE IF NOT EXISTS fee_advances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id),
        amount REAL NOT NULL,
        kind TEXT NOT NULL,
        invoice_id INTEGER REFERENCES fee_invoices(id),
        payment_id INTEGER REFERENCES fee_payments(id),
        receipt_number TEXT,
        payment_method TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        created_at TEXT NOT NULL,
        voided_at TEXT
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_fee_advances_student ON fee_advances(student_id)');
      // Cash actually received for fees: payments (not those settled from an
      // advance, which was counted when it came in) plus advances received.
      db.exec(`CREATE VIEW IF NOT EXISTS fee_cash_in AS
        SELECT payment_date, amount, discount_amount, NULL AS voided_at FROM fee_payments WHERE voided_at IS NULL AND payment_method <> 'Advance'
        UNION ALL
        SELECT substr(created_at, 1, 10) AS payment_date, amount, 0 AS discount_amount, NULL AS voided_at FROM fee_advances WHERE kind = 'received' AND voided_at IS NULL`);
    }
  }
];

MIGRATIONS.push({
  id: 19,
  description: 'Inventory items saved with the stock count typed in the Unit box (shown as "0 200") get that count as their stock',
  run(db) {
    const bad = db.prepare(`SELECT * FROM inventory_items WHERE quantity = 0 AND unit IS NOT NULL AND trim(unit) <> ''
      AND trim(unit) NOT GLOB '*[^0-9.]*' AND NOT EXISTS (SELECT 1 FROM inventory_moves m WHERE m.item_id = inventory_items.id)`).all();
    for (const it of bad) {
      const qty = Number(String(it.unit).trim());
      if (!(qty > 0)) continue;
      db.prepare(`INSERT INTO inventory_moves (item_id, kind, quantity, balance_after, moved_on, notes, created_by_name)
        VALUES (?, 'In', ?, ?, date('now', 'localtime'), 'Opening stock (moved from the Unit box)', 'System')`).run(it.id, qty, qty);
      db.prepare(`UPDATE inventory_items SET quantity = ?, unit = 'pcs' WHERE id = ?`).run(qty, it.id);
    }
  }
});

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Each migration + its bookkeeping row commit together, so a crash or a
    // power cut mid-upgrade can never leave a half-applied migration behind.
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.run(db);
      db.prepare('INSERT INTO schema_migrations (id, description) VALUES (?, ?)').run(migration.id, migration.description || null);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
      throw new Error(`Database migration ${migration.id} failed: ${err.message}`);
    }
  }
}

function getSchemaVersion(db) {
  const row = db.prepare('SELECT MAX(id) AS v FROM schema_migrations').get();
  return row?.v || 0;
}

module.exports = { runMigrations, getSchemaVersion, MIGRATIONS };
