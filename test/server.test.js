const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate this test run in its own throwaway data directory so it never
// touches a real school's database, and config.js must read the env var
// before the app module is required.
process.env.SMS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-test-'));
process.env.JWT_SECRET = 'test-secret';

const { createApp } = require('../server/server');
const { getDb } = require('../server/src/db/connection');
const { setSetting } = require('../server/src/services/settings');
const { getDeviceId } = require('../server/src/utils/fingerprint');
const { deriveLicenseKey } = require('../server/src/utils/licenseKey');
const config = require('../server/src/config');

async function startServer() {
  const app = createApp(); // ensures schema exists, including the settings table below

  // These tests exercise the app as an already-activated install (the normal
  // steady state after a school's first run) rather than the pre-activation
  // gate itself, which is covered separately by the license feature's own tests.
  // The stored key must actually validate against this machine's Device ID —
  // getLocalStatus re-derives and checks it on every call, so a fake string
  // here would just leave the app locked.
  const db = getDb();
  setSetting(db, 'license.key', deriveLicenseKey(getDeviceId(), config.license.signingSecret));
  setSetting(db, 'license.activatedAt', new Date().toISOString());

  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

test('full school workflow: auth, RBAC, students, attendance, fees, exams', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  await t.test('rejects requests without a token', async () => {
    const res = await fetch(`${baseUrl}/api/students`);
    assert.equal(res.status, 401);
  });

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  assert.ok(token);

  let classId; let sectionId; let subjectId; let teacherId; let studentId;

  await t.test('creates academic structure', async () => {
    const classRes = await fetch(`${baseUrl}/api/academics/classes`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name: 'Class 1', sort_order: 1 })
    });
    assert.equal(classRes.status, 201);
    classId = (await classRes.json()).id;

    const sectionRes = await fetch(`${baseUrl}/api/academics/sections`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ class_id: classId, name: 'A' })
    });
    assert.equal(sectionRes.status, 201);
    sectionId = (await sectionRes.json()).id;

    const subjectRes = await fetch(`${baseUrl}/api/academics/subjects`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name: 'Mathematics' })
    });
    assert.equal(subjectRes.status, 201);
    subjectId = (await subjectRes.json()).id;
  });

  await t.test('creates a teacher with a login', async () => {
    const res = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ full_name: 'Jane Doe', create_login: true, username: 'jane.doe', password: 'Teach@123' })
    });
    assert.equal(res.status, 201);
    teacherId = (await res.json()).id;

    await fetch(`${baseUrl}/api/academics/assignments`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ section_id: sectionId, subject_id: subjectId, teacher_id: teacherId })
    });
  });

  await t.test('admits a student and lists students without a 500 (pagination regression)', async () => {
    const res = await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ full_name: 'Alice Khan', section_id: sectionId, roll_number: 1, parent_name: 'Sara Khan' })
    });
    assert.equal(res.status, 201);
    studentId = (await res.json()).id;

    const listRes = await fetch(`${baseUrl}/api/students`, { headers: authHeaders(token) });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(list.rows.some((s) => s.id === studentId));
    assert.equal(list.pagination.total, 1);
  });

  let teacherToken;
  await t.test('teacher marks attendance and is auto-marked present', async () => {
    const teacherLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jane.doe', password: 'Teach@123' })
    });
    teacherToken = (await teacherLogin.json()).token;

    const today = new Date().toISOString().slice(0, 10);
    const markRes = await fetch(`${baseUrl}/api/attendance/mark`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ section_id: sectionId, attendance_date: today, records: [{ student_id: studentId, status: 'Present' }] })
    });
    assert.equal(markRes.status, 200);

    const teacherAttendanceRes = await fetch(`${baseUrl}/api/attendance/teacher/${teacherId}?from=${today}&to=${today}`, { headers: authHeaders(token) });
    const teacherAttendance = await teacherAttendanceRes.json();
    assert.equal(teacherAttendance[0].status, 'Present');
    assert.equal(teacherAttendance[0].source, 'auto');
  });

  await t.test('teacher cannot create a class (RBAC denial)', async () => {
    const res = await fetch(`${baseUrl}/api/academics/classes`, {
      method: 'POST', headers: authHeaders(teacherToken), body: JSON.stringify({ name: 'Class 2' })
    });
    assert.equal(res.status, 403);
  });

  await t.test('generates and pays a fee invoice', async () => {
    const headRes = await fetch(`${baseUrl}/api/fees/heads`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name: 'Tuition' }) });
    const feeHeadId = (await headRes.json()).id;
    await fetch(`${baseUrl}/api/fees/structures`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ class_id: classId, fee_head_id: feeHeadId, amount: 1000, academic_year: '2026' })
    });
    const genRes = await fetch(`${baseUrl}/api/fees/invoices/generate-bulk`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ class_id: classId, period_label: 'July 2026', due_date: '2026-07-31', academic_year: '2026' })
    });
    assert.equal((await genRes.json()).created, 1);

    const invoicesRes = await fetch(`${baseUrl}/api/fees/invoices`, { headers: authHeaders(token) });
    const invoices = await invoicesRes.json();
    assert.equal(invoices.length, 1);

    const payRes = await fetch(`${baseUrl}/api/fees/invoices/${invoices[0].id}/pay`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ amount: 500 })
    });
    assert.equal(payRes.status, 201);
    assert.equal((await payRes.json()).status, 'Partial');
  });

  await t.test('generates an exam paper from the question bank', async () => {
    await fetch(`${baseUrl}/api/exams/questions`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ subject_id: subjectId, marks: 5, question_type: 'Short', question_text: 'Solve for x: 2x+3=7' })
    });
    const paperRes = await fetch(`${baseUrl}/api/exams/papers/generate`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ title: 'Midterm', subject_id: subjectId, total_marks: 5, num_questions: 1 })
    });
    assert.equal(paperRes.status, 201);
  });

  let staffId;
  await t.test('creates a non-teaching staff member with an FK-backed category', async () => {
    const categoriesRes = await fetch(`${baseUrl}/api/staff/categories`, { headers: authHeaders(token) });
    const categories = await categoriesRes.json();
    const guard = categories.find((c) => c.name === 'Security Guard');
    assert.ok(guard, 'Security Guard category should be seeded');

    const res = await fetch(`${baseUrl}/api/staff`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ full_name: 'Bashir Ahmed', category_id: guard.id, phone: '03001112222' })
    });
    assert.equal(res.status, 201);
    staffId = (await res.json()).id;

    const listRes = await fetch(`${baseUrl}/api/staff`, { headers: authHeaders(token) });
    const list = await listRes.json();
    assert.ok(list.rows.some((s) => s.id === staffId && s.category_name === 'Security Guard'));
  });

  await t.test('marks staff attendance and records staff payroll separately from teacher payroll', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const markRes = await fetch(`${baseUrl}/api/staff/attendance/mark`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ attendance_date: today, records: [{ staff_id: staffId, status: 'Present' }] })
    });
    assert.equal(markRes.status, 200);

    await fetch(`${baseUrl}/api/payroll/staff/structures`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ staff_id: staffId, basic_salary: 25000 })
    });
    const now = new Date();
    const runRes = await fetch(`${baseUrl}/api/payroll/staff/run`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ staff_id: staffId, month: now.getMonth() + 1, year: now.getFullYear() })
    });
    assert.equal(runRes.status, 201);
    assert.equal((await runRes.json()).net_salary, 25000);

    // Confirm this landed in staff_payroll_runs, not the teacher payroll_runs table.
    const teacherRunsRes = await fetch(`${baseUrl}/api/payroll/runs`, { headers: authHeaders(token) });
    const teacherRuns = await teacherRunsRes.json();
    assert.ok(!teacherRuns.some((r) => r.net_salary === 25000));
  });

  await t.test('records a daily expense with an FK-backed category', async () => {
    const categoriesRes = await fetch(`${baseUrl}/api/expenses/categories`, { headers: authHeaders(token) });
    const categories = await categoriesRes.json();
    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ category_id: categories[0].id, amount: 1500, paid_to: 'City Electric' })
    });
    assert.equal(res.status, 201);

    const summaryRes = await fetch(`${baseUrl}/api/expenses/summary`, { headers: authHeaders(token) });
    const summary = await summaryRes.json();
    assert.equal(summary.todayTotal, 1500);
  });

  await t.test('generates a single exam-fee-only invoice and separate multi-month invoices without double-billing one-time fees', async () => {
    const headRes = await fetch(`${baseUrl}/api/fees/heads`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name: 'Exam Fee' }) });
    const examFeeId = (await headRes.json()).id;
    await fetch(`${baseUrl}/api/fees/structures`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ class_id: classId, fee_head_id: examFeeId, amount: 500, frequency: 'OneTime', academic_year: '2026' })
    });

    const examInvoiceRes = await fetch(`${baseUrl}/api/fees/invoices/generate-bulk`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ class_id: classId, academic_year: '2026', fee_head_id: examFeeId, period_label: 'Midterm Exam Fee', due_date: '2026-09-01' })
    });
    assert.equal((await examInvoiceRes.json()).created, 1);

    const invoicesRes = await fetch(`${baseUrl}/api/fees/invoices?fee_head_id=${examFeeId}`, { headers: authHeaders(token) });
    const examInvoices = await invoicesRes.json();
    assert.equal(examInvoices.length, 1);
    assert.equal(examInvoices[0].total_amount, 500);
    assert.equal(examInvoices[0].fee_head_name, 'Exam Fee');

    const multiRes = await fetch(`${baseUrl}/api/fees/invoices/generate-bulk`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({
        class_id: classId, academic_year: '2026',
        periods: [
          { period_label: 'October 2026', due_date: '2026-10-05' },
          { period_label: 'November 2026', due_date: '2026-11-05' }
        ]
      })
    });
    assert.equal((await multiRes.json()).created, 2);

    const allInvoicesRes = await fetch(`${baseUrl}/api/fees/invoices`, { headers: authHeaders(token) });
    const allInvoices = await allInvoicesRes.json();
    const octInvoice = allInvoices.find((i) => i.period_label === 'October 2026');
    const novInvoice = allInvoices.find((i) => i.period_label === 'November 2026');
    // Tuition (1000, Monthly) + Exam Fee (500, OneTime) on the first period only.
    assert.equal(octInvoice.total_amount, 1500);
    assert.equal(novInvoice.total_amount, 1000);
  });

  // ---- Regression tests for: editing records, photos, teacher attendance by
  // management, safe re-sync of queued mobile submissions, and backups. ----
  await t.test('editing a student only changes the fields sent (no silent wipes) and updates guardian', async () => {
    const setup = await fetch(`${baseUrl}/api/students/${studentId}`, {
      method: 'PUT', headers: authHeaders(token),
      body: JSON.stringify({ date_of_birth: '2015-04-01', blood_group: 'B+', address: 'Street 1' })
    });
    assert.equal(setup.status, 200);
    const res = await fetch(`${baseUrl}/api/students/${studentId}`, {
      method: 'PUT', headers: authHeaders(token),
      body: JSON.stringify({ full_name: 'Alice K. Khan', parent_phone: '03001234567', parent_relation: 'Mother' })
    });
    assert.equal(res.status, 200);
    const student = await (await fetch(`${baseUrl}/api/students/${studentId}`, { headers: authHeaders(token) })).json();
    assert.equal(student.full_name, 'Alice K. Khan');
    assert.equal(student.date_of_birth, '2015-04-01');
    assert.equal(student.blood_group, 'B+');
    assert.equal(student.address, 'Street 1');
    assert.equal(student.parent_name, 'Sara Khan');
    assert.equal(student.parent_phone, '03001234567');
    assert.equal(student.parent_relation, 'Mother');

    const blank = await fetch(`${baseUrl}/api/students/${studentId}`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ full_name: '  ' })
    });
    assert.equal(blank.status, 400);
  });

  await t.test('editing a teacher keeps the linked login in step', async () => {
    const res = await fetch(`${baseUrl}/api/teachers/${teacherId}`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ phone: '03111111111', designation: 'Senior Teacher' })
    });
    assert.equal(res.status, 200);
    const teacher = await (await fetch(`${baseUrl}/api/teachers/${teacherId}`, { headers: authHeaders(token) })).json();
    assert.equal(teacher.full_name, 'Jane Doe');
    assert.equal(teacher.phone, '03111111111');
    assert.equal(teacher.designation, 'Senior Teacher');
  });

  await t.test('uploads a student photo and rejects non-images', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('photo', new Blob([png], { type: 'image/png' }), 'face.png');
    const res = await fetch(`${baseUrl}/api/students/${studentId}/photo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(res.status, 200);
    const { file } = await res.json();
    assert.ok(fs.existsSync(path.join(config.uploadsDir, file)));
    const served = await fetch(`${baseUrl}/uploads/${file}`);
    assert.equal(served.status, 200);

    const bad = new FormData();
    bad.append('photo', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'doc.pdf');
    const badRes = await fetch(`${baseUrl}/api/students/${studentId}/photo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: bad });
    assert.equal(badRes.status, 400);
  });

  await t.test('principal/admin marks teacher attendance in bulk; teachers cannot', async () => {
    const date = '2026-11-02';
    const res = await fetch(`${baseUrl}/api/attendance/teachers/mark`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ attendance_date: date, records: [{ teacher_id: teacherId, status: 'Leave', remarks: 'Wedding' }] })
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).marked, 1);
    const roster = await (await fetch(`${baseUrl}/api/attendance/teachers?date=${date}`, { headers: authHeaders(token) })).json();
    const row = roster.find((r) => r.teacher_id === teacherId);
    assert.equal(row.status, 'Leave');
    assert.equal(row.source, 'manual');

    const denied = await fetch(`${baseUrl}/api/attendance/teachers/mark`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ attendance_date: date, records: [{ teacher_id: teacherId, status: 'Present' }] })
    });
    assert.equal(denied.status, 403);

    // A teacher submitting class attendance afterwards must not overwrite the manual entry.
    await fetch(`${baseUrl}/api/attendance/mark`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ section_id: sectionId, attendance_date: date, records: [{ student_id: studentId, status: 'Present' }] })
    });
    const after = await (await fetch(`${baseUrl}/api/attendance/teachers?date=${date}`, { headers: authHeaders(token) })).json();
    assert.equal(after.find((r) => r.teacher_id === teacherId).status, 'Leave');
  });

  await t.test('re-sending a queued mobile submission is safe and corrected rows are reported, not silently dropped', async () => {
    const date = '2026-11-03';
    const body = JSON.stringify({ section_id: sectionId, attendance_date: date, records: [{ student_id: studentId, status: 'Absent' }] });
    for (let i = 0; i < 2; i += 1) {
      const r = await fetch(`${baseUrl}/api/attendance/mark`, { method: 'POST', headers: authHeaders(teacherToken), body });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).marked, 1);
    }
    const roster = await (await fetch(`${baseUrl}/api/attendance/section/${sectionId}?date=${date}`, { headers: authHeaders(token) })).json();
    assert.equal(roster.length, 1);
    assert.equal(roster[0].status, 'Absent');

    await fetch(`${baseUrl}/api/attendance/student/${roster[0].attendance_id}/correct`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ status: 'Late' })
    });
    const again = await fetch(`${baseUrl}/api/attendance/mark`, { method: 'POST', headers: authHeaders(teacherToken), body });
    const result = await again.json();
    assert.equal(result.marked, 0);
    assert.equal(result.skipped[0].reason, 'corrected_by_admin');

    const bad = await fetch(`${baseUrl}/api/attendance/mark`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ section_id: sectionId, attendance_date: 'today', records: [{ student_id: studentId, status: 'Present' }] })
    });
    assert.equal(bad.status, 400);

    // A phone with a clock set ahead must not file attendance under "tomorrow".
    const d = new Date(); d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const future = await fetch(`${baseUrl}/api/attendance/mark`, {
      method: 'POST', headers: authHeaders(teacherToken),
      body: JSON.stringify({ section_id: sectionId, attendance_date: tomorrow, records: [{ student_id: studentId, status: 'Present' }] })
    });
    assert.equal(future.status, 400);
    const serverDate = await (await fetch(`${baseUrl}/api/attendance/server-date`, { headers: authHeaders(teacherToken) })).json();
    assert.match(serverDate.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('staff attendance roster loads (was swallowed by GET /staff/:id) and staff edits keep other fields', async () => {
    const roster = await fetch(`${baseUrl}/api/staff/attendance`, { headers: authHeaders(token) });
    assert.equal(roster.status, 200);
    const rows = await roster.json();
    assert.ok(Array.isArray(rows) && rows.some((r) => r.staff_id === staffId));

    const res = await fetch(`${baseUrl}/api/staff/${staffId}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ address: 'Gate 2' }) });
    assert.equal(res.status, 200);
    const member = await (await fetch(`${baseUrl}/api/staff/${staffId}`, { headers: authHeaders(token) })).json();
    assert.equal(member.address, 'Gate 2');
    assert.equal(member.phone, '03001112222');
    assert.equal(member.full_name, 'Bashir Ahmed');
  });

  await t.test('a wrong invoice can be edited, payments corrected/voided, and the invoice cancelled', async () => {
    const invoices = await (await fetch(`${baseUrl}/api/fees/invoices`, { headers: authHeaders(token) })).json();
    const inv = invoices.find((i) => i.status === 'Pending');
    const detail = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: authHeaders(token) })).json();
    const items = detail.items.map((it) => ({ fee_head_id: it.fee_head_id, amount: 700, discount_amount: 0 }));

    const editRes = await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ items, fine_amount: 50, due_date: '2026-12-10' })
    });
    assert.equal(editRes.status, 200);
    const edited = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: authHeaders(token) })).json();
    assert.equal(edited.total_amount, 700 * items.length);
    assert.equal(edited.fine_amount, 50);
    assert.equal(edited.due_date, '2026-12-10');

    const pay = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}/pay`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ amount: 300 })
    })).json();
    assert.equal(pay.status, 'Partial');

    // Cannot shrink below what was paid, cannot cancel while a payment stands.
    const tooLow = await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ items: [{ fee_head_id: items[0].fee_head_id, amount: 100 }], fine_amount: 0 })
    });
    assert.equal(tooLow.status, 400);
    const cancelBlocked = await fetch(`${baseUrl}/api/fees/invoices/${inv.id}/cancel`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason: 'dup' }) });
    assert.equal(cancelBlocked.status, 400);

    const fix = await fetch(`${baseUrl}/api/fees/payments/${pay.id}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ amount: 250 }) });
    assert.equal(fix.status, 200);
    let after = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: authHeaders(token) })).json();
    assert.equal(after.paid_amount, 250);

    const voidRes = await fetch(`${baseUrl}/api/fees/payments/${pay.id}/void`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason: 'Entered twice' }) });
    assert.equal(voidRes.status, 200);
    after = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: authHeaders(token) })).json();
    assert.equal(after.paid_amount, 0);
    assert.equal(after.status, 'Pending');

    const cancel = await fetch(`${baseUrl}/api/fees/invoices/${inv.id}/cancel`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason: 'Created by mistake' }) });
    assert.equal(cancel.status, 200);
    const outstanding = await (await fetch(`${baseUrl}/api/fees/outstanding`, { headers: authHeaders(token) })).json();
    assert.ok(!outstanding.some((o) => o.id === inv.id));

    const history = await (await fetch(`${baseUrl}/api/history/fee_invoice/${inv.id}`, { headers: authHeaders(token) })).json();
    const actions = history.map((h) => h.action);
    assert.ok(actions.includes('edit_invoice') && actions.includes('cancel_invoice') && actions.includes('void_payment'));
  });

  await t.test('expenses can be corrected and "deleted" without losing the record; history shows the change', async () => {
    const categories = await (await fetch(`${baseUrl}/api/expenses/categories`, { headers: authHeaders(token) })).json();
    const created = await (await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ category_id: categories[0].id, amount: 9000, paid_to: 'Typo Ltd' })
    })).json();
    const upd = await fetch(`${baseUrl}/api/expenses/${created.id}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ amount: 900 }) });
    assert.equal(upd.status, 200);
    const history = await (await fetch(`${baseUrl}/api/history/expense/${created.id}`, { headers: authHeaders(token) })).json();
    const update = history.find((h) => h.action === 'update');
    assert.equal(update.details.changes.amount.from, 9000);
    assert.equal(update.details.changes.amount.to, 900);

    const noReason = await fetch(`${baseUrl}/api/expenses/${created.id}`, { method: 'DELETE', headers: authHeaders(token) });
    assert.equal(noReason.status, 400);
    const del = await fetch(`${baseUrl}/api/expenses/${created.id}?reason=${encodeURIComponent('Duplicate entry')}`, { method: 'DELETE', headers: authHeaders(token) });
    assert.equal(del.status, 200);
    const visible = await (await fetch(`${baseUrl}/api/expenses`, { headers: authHeaders(token) })).json();
    assert.ok(!visible.some((e) => e.id === created.id));
    const withDeleted = await (await fetch(`${baseUrl}/api/expenses?include_deleted=true`, { headers: authHeaders(token) })).json();
    const kept = withDeleted.find((e) => e.id === created.id);
    assert.equal(kept.delete_reason, 'Duplicate entry');
    assert.equal(kept.edit_count, 1);
  });

  await t.test('toggling a user inactive no longer wipes their email/phone; edits to classes/subjects work', async () => {
    const created = await (await fetch(`${baseUrl}/api/users`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ username: 'acct1', password: 'Acct@1234', role: 'accountant', full_name: 'Acc One', email: 'a@b.c', phone: '0300' })
    })).json();
    await fetch(`${baseUrl}/api/users/${created.id}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ is_active: 0 }) });
    const users = await (await fetch(`${baseUrl}/api/users`, { headers: authHeaders(token) })).json();
    const u = users.find((x) => x.id === created.id);
    assert.equal(u.is_active, 0);
    assert.equal(u.email, 'a@b.c');
    assert.equal(u.phone, '0300');

    const cls = await fetch(`${baseUrl}/api/academics/classes/${classId}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ name: 'Class One' }) });
    assert.equal(cls.status, 200);
    const sub = await fetch(`${baseUrl}/api/academics/subjects/${subjectId}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ code: 'MATH' }) });
    assert.equal(sub.status, 200);
    const delUsed = await fetch(`${baseUrl}/api/academics/subjects/${subjectId}`, { method: 'DELETE', headers: authHeaders(token) });
    assert.equal(delUsed.status, 409);
  });

  await t.test('staff member is relieved, drops off later rosters, and re-joins with a new salary', async () => {
    const rel = await fetch(`${baseUrl}/api/staff/${staffId}/relieve`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ relieving_date: '2026-11-10', reason: 'Resigned' })
    });
    assert.equal(rel.status, 200);
    const later = await (await fetch(`${baseUrl}/api/staff/attendance?date=2026-11-20`, { headers: authHeaders(token) })).json();
    assert.ok(!later.some((r) => r.staff_id === staffId));
    const before = await (await fetch(`${baseUrl}/api/staff/attendance?date=2026-11-05`, { headers: authHeaders(token) })).json();
    assert.ok(before.some((r) => r.staff_id === staffId));

    const badDate = await fetch(`${baseUrl}/api/staff/${staffId}/rejoin`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ rejoin_date: '2026-11-01', keep_salary: true })
    });
    assert.equal(badDate.status, 400);
    const rej = await fetch(`${baseUrl}/api/staff/${staffId}/rejoin`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ rejoin_date: '2026-11-15', keep_salary: false, basic_salary: 28000 })
    });
    assert.equal(rej.status, 200);
    const structure = await (await fetch(`${baseUrl}/api/payroll/staff/structures/${staffId}`, { headers: authHeaders(token) })).json();
    assert.equal(structure.basic_salary, 28000);
    assert.equal(structure.effective_from, '2026-11-15');
    const hist = await (await fetch(`${baseUrl}/api/staff/${staffId}/employment-history`, { headers: authHeaders(token) })).json();
    assert.deepEqual(hist.map((h) => h.event), ['Rejoined', 'Relieved']);
    assert.equal(hist[0].salary_before, 25000);
    assert.equal(hist[0].salary_after, 28000);
  });

  await t.test('relieving a teacher disables their login; removing a user archives it', async () => {
    const rel = await fetch(`${baseUrl}/api/teachers/${teacherId}/relieve`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason: 'Contract ended' }) });
    assert.equal(rel.status, 200);
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jane.doe', password: 'Teach@123' }) });
    assert.equal(login.status, 401);
    await fetch(`${baseUrl}/api/teachers/${teacherId}/rejoin`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ keep_salary: true }) });
    const loginAgain = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jane.doe', password: 'Teach@123' }) });
    assert.equal(loginAgain.status, 200);

    const users = await (await fetch(`${baseUrl}/api/users`, { headers: authHeaders(token) })).json();
    const acct = users.find((u) => u.username === 'acct1');
    const del = await fetch(`${baseUrl}/api/users/${acct.id}`, { method: 'DELETE', headers: authHeaders(token) });
    assert.equal(del.status, 200);
    const visible = await (await fetch(`${baseUrl}/api/users`, { headers: authHeaders(token) })).json();
    assert.ok(!visible.some((u) => u.id === acct.id));
    const all = await (await fetch(`${baseUrl}/api/users?include_archived=true`, { headers: authHeaders(token) })).json();
    assert.ok(all.find((u) => u.id === acct.id).archived_at);
    const me = users.find((u) => u.username === 'admin');
    const self = await fetch(`${baseUrl}/api/users/${me.id}`, { method: 'DELETE', headers: authHeaders(token) });
    assert.equal(self.status, 400);
  });

  await t.test('backups capture the latest writes (WAL included) and LAN info lists adapters', async () => {
    const backupService = require('../server/src/services/backup');
    const { DatabaseSync } = require('node:sqlite');
    const backup = backupService.createBackup('test-backup');
    const copy = new DatabaseSync(backup.path, { readOnly: true });
    const row = copy.prepare('SELECT full_name FROM students WHERE id = ?').get(studentId);
    copy.close();
    assert.equal(row.full_name, 'Alice K. Khan');

    const lan = await (await fetch(`${baseUrl}/api/settings/lan-info`, { headers: authHeaders(token) })).json();
    assert.ok(Array.isArray(lan.options));
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.app, 'chand-sms');
  });

  await t.test('management grants per-area permissions; others get only what they are given', async () => {
    const created = await (await fetch(`${baseUrl}/api/users`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ username: 'acct2', password: 'Acct@1234', role: 'accountant', full_name: 'Acc Two' })
    })).json();
    const login = async () => (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'acct2', password: 'Acct@1234' })
    })).json());
    const first = await login();
    const acct = first.token;
    assert.equal(first.user.permissions.fees, 'manage');
    assert.equal(first.user.permissions.academics, 'none');

    // Default: accountant can't touch classes.
    const denied = await fetch(`${baseUrl}/api/academics/classes`, { method: 'POST', headers: authHeaders(acct), body: JSON.stringify({ name: 'Perm Class' }) });
    assert.equal(denied.status, 403);
    assert.match((await denied.json()).error, /Admin, Principal or Super Admin/);

    // Only management may change permissions.
    const selfGrant = await fetch(`${baseUrl}/api/users/${created.id}/permissions`, { method: 'PUT', headers: authHeaders(acct), body: JSON.stringify({ permissions: { academics: 'manage' } }) });
    assert.equal(selfGrant.status, 403);

    // Admin grants Classes (manage) and removes Expenses — takes effect without re-login.
    const grant = await fetch(`${baseUrl}/api/users/${created.id}/permissions`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ permissions: { academics: 'manage', expenses: 'none' } })
    });
    assert.equal(grant.status, 200);
    const ok = await fetch(`${baseUrl}/api/academics/classes`, { method: 'POST', headers: authHeaders(acct), body: JSON.stringify({ name: 'Perm Class' }) });
    assert.equal(ok.status, 201);
    const noExpenses = await fetch(`${baseUrl}/api/expenses`, { headers: authHeaders(acct) });
    assert.equal(noExpenses.status, 403);

    // View-only: can read, not change.
    await fetch(`${baseUrl}/api/users/${created.id}/permissions`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ permissions: { academics: 'view' } }) });
    const viewOnly = await fetch(`${baseUrl}/api/academics/classes`, { method: 'POST', headers: authHeaders(acct), body: JSON.stringify({ name: 'Another' }) });
    assert.equal(viewOnly.status, 403);
    assert.match((await viewOnly.json()).error, /view-only/);

    const perms = await (await fetch(`${baseUrl}/api/users/${created.id}/permissions`, { headers: authHeaders(token) })).json();
    assert.equal(perms.effective.academics, 'view');
    assert.equal(perms.effective.expenses, 'none');
    assert.equal(perms.effective.fees, 'manage');

    // Even with User Accounts access, a non-management user cannot create a Super Admin.
    await fetch(`${baseUrl}/api/users/${created.id}/permissions`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ permissions: { users: 'manage' } }) });
    const escalate = await fetch(`${baseUrl}/api/users`, {
      method: 'POST', headers: authHeaders(acct), body: JSON.stringify({ username: 'evil', password: 'Evil@1234', role: 'super_admin', full_name: 'X' })
    });
    assert.equal(escalate.status, 403);
    const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders(acct) })).json();
    assert.equal(me.permissions.users, 'manage');
  });

  await t.test('teacher self check-in marks Present once, on the server date, never overwriting', async () => {
    const adminView = await (await fetch(`${baseUrl}/api/attendance/me/today`, { headers: authHeaders(token) })).json();
    assert.equal(adminView.applicable, false);
    const adminTry = await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(token), body: '{}' });
    assert.equal(adminTry.status, 400);

    const { date } = await (await fetch(`${baseUrl}/api/attendance/server-date`, { headers: authHeaders(teacherToken) })).json();
    getDb().prepare('DELETE FROM teacher_attendance WHERE teacher_id = ? AND attendance_date = ?').run(teacherId, date);
    const before = await (await fetch(`${baseUrl}/api/attendance/me/today`, { headers: authHeaders(teacherToken) })).json();
    assert.equal(before.applicable, true);
    assert.equal(before.date, date);
    assert.equal(before.record, null);

    const first = await (await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(teacherToken), body: '{}' })).json();
    assert.equal(first.created, true);
    assert.equal(first.record.status, 'Present');
    assert.equal(first.record.source, 'self');
    const second = await (await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(teacherToken), body: '{}' })).json();
    assert.equal(second.created, false);

    // An office mark wins over a later check-in attempt.
    await fetch(`${baseUrl}/api/attendance/teachers/mark`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ attendance_date: date, records: [{ teacher_id: teacherId, status: 'Late' }] })
    });
    const third = await (await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(teacherToken), body: '{}' })).json();
    assert.equal(third.created, false);
    assert.equal(third.record.status, 'Late');
  });

  await t.test('dashboard finance summary: fees - salaries - expenses = profit/loss', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/finance?period=year`, { headers: authHeaders(token) });
    const f = await res.json();
    assert.equal(res.status, 200, f.error);
    for (const k of ['fees', 'salaries', 'expenses']) assert.equal(typeof f[k].total, 'number');
    assert.equal(f.profit, Math.round((f.fees.total - f.salaries.total - f.expenses.total) * 100) / 100);
    assert.equal(f.months.length, 6);

    const db = getDb();
    const yearStart = `${f.to.slice(0, 4)}-01-01`;
    const fees = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE payment_date BETWEEN ? AND ? AND voided_at IS NULL').get(yearStart, f.to).s;
    assert.equal(f.fees.total, Math.round(fees * 100) / 100);

    const custom = await fetch(`${baseUrl}/api/dashboard/finance?period=custom&from=2026-05-01&to=2026-04-01`, { headers: authHeaders(token) });
    assert.equal(custom.status, 400);
    const teacherRes = await fetch(`${baseUrl}/api/dashboard/finance`, { headers: authHeaders(teacherToken) });
    assert.equal(teacherRes.status, 403);
  });

  await t.test('non-teaching staff can check in themselves; the office mark still wins', async () => {
    const cats = await (await fetch(`${baseUrl}/api/staff/categories`, { headers: authHeaders(token) })).json();
    const created = await (await fetch(`${baseUrl}/api/staff`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ full_name: 'Self Checker', category_id: cats[0].id })
    })).json();
    // Login added later, from the edit form.
    const put = await fetch(`${baseUrl}/api/staff/${created.id}`, {
      method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ create_login: true, username: 'selfcheck', password: 'Self@1234' })
    });
    assert.equal(put.status, 200, (await put.json()).error);
    const login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'selfcheck', password: 'Self@1234' })
    })).json();
    assert.equal(login.user.staff_id, created.id);
    const st = login.token;

    const before = await (await fetch(`${baseUrl}/api/attendance/me/today`, { headers: authHeaders(st) })).json();
    assert.equal(before.applicable, true);
    assert.equal(before.kind, 'staff');
    assert.equal(before.record, null);
    const first = await (await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(st), body: '{}' })).json();
    assert.equal(first.created, true);
    assert.equal(first.record.source, 'self');

    const roster = await (await fetch(`${baseUrl}/api/staff/attendance?date=${first.date}`, { headers: authHeaders(token) })).json();
    const row = roster.find((r) => r.staff_id === created.id);
    assert.equal(row.status, 'Present');
    assert.equal(row.source, 'self');

    await fetch(`${baseUrl}/api/staff/attendance/mark`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ attendance_date: first.date, records: [{ staff_id: created.id, status: 'Absent' }] })
    });
    const again = await (await fetch(`${baseUrl}/api/attendance/me/check-in`, { method: 'POST', headers: authHeaders(st), body: '{}' })).json();
    assert.equal(again.created, false);
    assert.equal(again.record.status, 'Absent');
  });

  await t.test('a student who leaves school stops being billed and leaves the roster; re-admit restores', async () => {
    const s = await (await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ full_name: 'Moving Away', section_id: sectionId })
    })).json();
    const gen = await fetch(`${baseUrl}/api/fees/invoices/generate-bulk`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ section_id: sectionId, academic_year: '2026', periods: [
        { period_label: 'Aug 2026', due_date: '2026-08-10' }, { period_label: 'Sep 2026', due_date: '2026-09-10' }
      ] })
    });
    assert.ok(gen.ok);
    const db = getDb();
    const invs = () => db.prepare('SELECT period_label, status, cancel_reason FROM fee_invoices WHERE student_id = ? ORDER BY due_date').all(s.id);
    assert.equal(invs().length, 2);

    const preview = await (await fetch(`${baseUrl}/api/students/${s.id}/leave-preview?left_on=2026-08-20`, { headers: authHeaders(token) })).json();
    assert.equal(preview.after.length, 1);
    assert.equal(preview.allUnpaid.length, 2);

    const leave = await (await fetch(`${baseUrl}/api/students/${s.id}/leave`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ left_on: '2026-08-20', leaving_type: 'Moved / Shifted', reason: 'Family moved', cancel_invoices: 'after' })
    })).json();
    assert.equal(leave.cancelled, 1);
    assert.ok(leave.outstanding > 0, 'August dues are still owed');
    const after = invs();
    assert.equal(after[0].status, 'Pending');
    assert.equal(after[1].status, 'Cancelled');
    assert.match(after[1].cancel_reason, /left school on 2026-08-20/);

    // Not billed again, not in the current list, not on today's roster.
    await fetch(`${baseUrl}/api/fees/invoices/generate-bulk`, {
      method: 'POST', headers: authHeaders(token),
      body: JSON.stringify({ section_id: sectionId, academic_year: '2026', period_label: 'Oct 2026', due_date: '2026-10-10' })
    });
    assert.equal(invs().length, 2);
    const current = await (await fetch(`${baseUrl}/api/students?limit=200`, { headers: authHeaders(token) })).json();
    assert.ok(!current.rows.some((r) => r.id === s.id));
    const left = await (await fetch(`${baseUrl}/api/students?limit=200&enrollment=left`, { headers: authHeaders(token) })).json();
    const leftRow = left.rows.find((r) => r.id === s.id);
    assert.equal(leftRow.status, 'Left');
    assert.equal(leftRow.left_on, '2026-08-20');
    const { date } = await (await fetch(`${baseUrl}/api/attendance/server-date`, { headers: authHeaders(token) })).json();
    const roster = await (await fetch(`${baseUrl}/api/attendance/section/${sectionId}?date=${date}`, { headers: authHeaders(token) })).json();
    assert.ok(!roster.some((r) => r.student_id === s.id));

    const again = await fetch(`${baseUrl}/api/students/${s.id}/leave`, { method: 'POST', headers: authHeaders(token), body: '{}' });
    assert.equal(again.status, 400);

    const re = await fetch(`${baseUrl}/api/students/${s.id}/readmit`, { method: 'POST', headers: authHeaders(token), body: '{}' });
    assert.equal(re.status, 200);
    const back = await (await fetch(`${baseUrl}/api/students?limit=200`, { headers: authHeaders(token) })).json();
    assert.equal(back.rows.find((r) => r.id === s.id).status, 'Active');
  });

  await t.test('salary payments record mode, payer and time; approval records name + designation; fee payments record receiver and can be verified', async () => {
    const H = authHeaders(token);
    const runs = await (await fetch(`${baseUrl}/api/payroll/staff/runs`, { headers: H })).json();
    const run = runs.find((r) => r.status !== 'Paid');
    assert.ok(run, 'a pending staff payslip exists');

    const badMode = await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/mark-paid`, { method: 'PUT', headers: H, body: JSON.stringify({ payment_mode: 'Gold' }) });
    assert.equal(badMode.status, 400);
    const noCheque = await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/mark-paid`, { method: 'PUT', headers: H, body: JSON.stringify({ payment_mode: 'Cheque' }) });
    assert.equal(noCheque.status, 400);

    const appr = await (await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/approve`, { method: 'PUT', headers: H, body: '{}' })).json();
    assert.ok(appr.approved_by_name);
    assert.ok(appr.approved_by_designation);
    assert.match(appr.approved_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const teacherApprove = await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/approve`, { method: 'PUT', headers: authHeaders(teacherToken), body: '{}' });
    assert.equal(teacherApprove.status, 403);

    const paid = await (await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/mark-paid`, {
      method: 'PUT', headers: H, body: JSON.stringify({ payment_mode: 'Cheque', payment_reference: 'CHQ-0042' })
    })).json();
    assert.equal(paid.payment_mode, 'Cheque');
    const after = (await (await fetch(`${baseUrl}/api/payroll/staff/runs`, { headers: H })).json()).find((r) => r.id === run.id);
    assert.equal(after.status, 'Paid');
    assert.equal(after.payment_reference, 'CHQ-0042');
    assert.ok(after.paid_by_name);
    assert.match(after.paid_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const slip = await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/payslip.pdf`, { headers: H });
    assert.equal(slip.status, 200);
    const twice = await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/mark-paid`, { method: 'PUT', headers: H, body: JSON.stringify({ payment_mode: 'Cash' }) });
    assert.equal(twice.status, 400);
    await fetch(`${baseUrl}/api/payroll/staff/runs/${run.id}/mark-unpaid`, { method: 'PUT', headers: H, body: '{}' });
    const undone = (await (await fetch(`${baseUrl}/api/payroll/staff/runs`, { headers: H })).json()).find((r) => r.id === run.id);
    assert.equal(undone.payment_mode, null);
    assert.equal(undone.paid_by_name, null);

    // Fee payment: receiver name + exact time are stored; verification is recorded.
    const invoices = await (await fetch(`${baseUrl}/api/fees/invoices`, { headers: H })).json();
    const inv = invoices.find((i) => i.status === 'Pending' || i.status === 'Partial');
    const pay = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}/pay`, {
      method: 'POST', headers: H, body: JSON.stringify({ amount: 10, payment_method: 'Online Transfer', payment_reference: 'TXN-77' })
    })).json();
    const detail = await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: H })).json();
    const p = detail.payments.find((x) => x.id === pay.id);
    assert.equal(p.payment_method, 'Online Transfer');
    assert.equal(p.payment_reference, 'TXN-77');
    assert.ok(p.received_by_name);
    assert.match(p.recorded_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const v = await (await fetch(`${baseUrl}/api/fees/payments/${pay.id}/verify`, { method: 'POST', headers: H, body: '{}' })).json();
    assert.ok(v.verified_by_name && v.verified_at);
    const receipt = await fetch(`${baseUrl}/api/fees/payments/${pay.id}/receipt.pdf`, { headers: H });
    assert.equal(receipt.status, 200);
    // Changing the amount clears the verification.
    await fetch(`${baseUrl}/api/fees/payments/${pay.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ amount: 12 }) });
    const p2 = (await (await fetch(`${baseUrl}/api/fees/invoices/${inv.id}`, { headers: H })).json()).payments.find((x) => x.id === pay.id);
    assert.equal(p2.verified_at, null);
    await fetch(`${baseUrl}/api/fees/payments/${pay.id}/void`, { method: 'POST', headers: H, body: JSON.stringify({ reason: 'test' }) });
  });

  await t.test('a paper holds only the questions the teacher picked, with their marks; Urdu questions print', async () => {
    const TH = authHeaders(teacherToken);
    const mk = async (body) => (await (await fetch(`${baseUrl}/api/exams/questions`, { method: 'POST', headers: TH, body: JSON.stringify({ subject_id: subjectId, ...body }) })).json()).id;
    const q1 = await mk({ marks: 2, question_type: 'Short', chapter: 'Ch 1', question_text: 'What is 2 + 2?' });
    const q2 = await mk({ marks: 1, question_type: 'MCQ', chapter: 'Ch 2', question_text: 'پاکستان کا دارالحکومت کون سا شہر ہے؟', options: ['لاہور', 'اسلام آباد', 'کراچی'] });
    await mk({ marks: 5, question_type: 'Long', chapter: 'Ch 3', question_text: 'Not on this paper' });

    const noQs = await fetch(`${baseUrl}/api/exams/papers`, { method: 'POST', headers: TH, body: JSON.stringify({ title: 'Empty', subject_id: subjectId, questions: [] }) });
    assert.equal(noQs.status, 400);
    const res = await fetch(`${baseUrl}/api/exams/papers`, {
      method: 'POST', headers: TH,
      body: JSON.stringify({ title: 'ماہانہ ٹیسٹ', subject_id: subjectId, class_id: classId, duration_minutes: 40, questions: [{ id: q2, marks: 3 }, { id: q1 }] })
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.question_count, 2);
    assert.equal(created.total_marks, 5);
    const paper = await (await fetch(`${baseUrl}/api/exams/papers/${created.id}`, { headers: TH })).json();
    assert.deepEqual(paper.questions.map((q) => q.id), [q2, q1]);
    assert.equal(paper.questions[0].marks_override, 3);
    assert.equal(paper.questions[1].marks_override, null);

    const edit = await (await fetch(`${baseUrl}/api/exams/papers/${created.id}`, {
      method: 'PUT', headers: TH, body: JSON.stringify({ title: 'ماہانہ ٹیسٹ', subject_id: subjectId, questions: [{ id: q1, marks: 4 }] })
    })).json();
    assert.equal(edit.total_marks, 4);
    assert.equal(edit.question_count, 1);
    await fetch(`${baseUrl}/api/exams/papers/${created.id}`, {
      method: 'PUT', headers: TH, body: JSON.stringify({ title: 'ماہانہ ٹیسٹ', subject_id: subjectId, questions: [{ id: q2 }, { id: q1 }] })
    });
    const pdf = await fetch(`${baseUrl}/api/exams/papers/${created.id}/pdf`, { headers: TH });
    assert.equal(pdf.status, 200);
    assert.ok((await pdf.arrayBuffer()).byteLength > 1000);
    const docx = await fetch(`${baseUrl}/api/exams/papers/${created.id}/docx`, { headers: TH });
    assert.equal(docx.status, 200);
  });

  await t.test('marks, progress reports and result cards: teacher scope, grades, pass/fail, position, approval', async () => {
    const H = authHeaders(token);
    const TH = authHeaders(teacherToken);
    const meta = await (await fetch(`${baseUrl}/api/results/meta`, { headers: TH })).json();
    assert.ok(meta.sections.some((s) => s.id === sectionId), 'teacher sees the section they teach');

    const term = await (await fetch(`${baseUrl}/api/results/terms`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Annual Examination 2026', kind: 'Annual' }) })).json();
    const teacherTerm = await fetch(`${baseUrl}/api/results/terms`, { method: 'POST', headers: TH, body: JSON.stringify({ name: 'x' }) });
    assert.equal(teacherTerm.status, 403);

    // Teacher adds a daily test for their subject and an annual paper.
    const daily = await (await fetch(`${baseUrl}/api/results/assessments`, {
      method: 'POST', headers: TH, body: JSON.stringify({ kind: 'Daily Test', section_id: sectionId, subject_id: subjectId, held_on: '2026-11-02', total_marks: 10 })
    })).json();
    const annual = await (await fetch(`${baseUrl}/api/results/assessments`, {
      method: 'POST', headers: TH, body: JSON.stringify({ kind: 'Annual Exam', section_id: sectionId, subject_id: subjectId, term_id: term.id, held_on: '2026-11-20', total_marks: 100 })
    })).json();
    assert.ok(daily.id && annual.id);

    // A subject the teacher does not teach is refused.
    const other = await (await fetch(`${baseUrl}/api/academics/subjects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'English' }) })).json();
    const refused = await fetch(`${baseUrl}/api/results/assessments`, {
      method: 'POST', headers: TH, body: JSON.stringify({ kind: 'Daily Test', section_id: sectionId, subject_id: other.id, held_on: '2026-11-02', total_marks: 10 })
    });
    assert.equal(refused.status, 403);
    const eng = await (await fetch(`${baseUrl}/api/results/assessments`, {
      method: 'POST', headers: H, body: JSON.stringify({ kind: 'Annual Exam', section_id: sectionId, subject_id: other.id, term_id: term.id, held_on: '2026-11-21', total_marks: 50, pass_marks: 20 })
    })).json();

    const roster = await (await fetch(`${baseUrl}/api/results/assessments/${annual.id}/marks`, { headers: TH })).json();
    const ids = roster.rows.map((r) => r.student_id);
    assert.ok(ids.includes(studentId));
    const tooHigh = await fetch(`${baseUrl}/api/results/assessments/${annual.id}/marks`, { method: 'PUT', headers: TH, body: JSON.stringify({ marks: [{ student_id: studentId, obtained: 101 }] }) });
    assert.equal(tooHigh.status, 400);

    // Alice: 8/10 daily, 90/100 maths, 40/50 English -> 130/150 = 86.7% A, Pass, position 1.
    // Others: 25/100 maths (fail), 45/50 English.
    const others = ids.filter((id) => id !== studentId);
    await fetch(`${baseUrl}/api/results/assessments/${daily.id}/marks`, { method: 'PUT', headers: TH, body: JSON.stringify({ marks: [{ student_id: studentId, obtained: 8 }] }) });
    await fetch(`${baseUrl}/api/results/assessments/${annual.id}/marks`, {
      method: 'PUT', headers: TH, body: JSON.stringify({ marks: [{ student_id: studentId, obtained: 90 }, ...others.map((id) => ({ student_id: id, obtained: 25 }))] })
    });
    const engSave = await fetch(`${baseUrl}/api/results/assessments/${eng.id}/marks`, {
      method: 'PUT', headers: H, body: JSON.stringify({ marks: [{ student_id: studentId, obtained: 40 }, ...others.map((id) => ({ student_id: id, obtained: 45 }))] })
    });
    assert.equal(engSave.status, 200);

    const prog = await (await fetch(`${baseUrl}/api/results/students/${studentId}/progress?from=2026-11-01&to=2026-11-30`, { headers: TH })).json();
    assert.equal(prog.overall.tests, 3);
    assert.equal(prog.overall.obtained, 138);
    assert.equal(prog.overall.total, 160);
    const daily1 = await (await fetch(`${baseUrl}/api/results/students/${studentId}/progress?from=2026-11-02&to=2026-11-02&kind=Daily%20Test`, { headers: TH })).json();
    assert.equal(daily1.overall.percentage, 80);
    assert.equal(daily1.overall.grade, 'A');
    const progPdf = await fetch(`${baseUrl}/api/results/students/${studentId}/progress.pdf?from=2026-11-01&to=2026-11-30`, { headers: TH });
    assert.equal(progPdf.status, 200);

    const sheet = await (await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}`, { headers: TH })).json();
    assert.equal(sheet.subjects.length, 2);
    const alice = sheet.students.find((s) => s.student_id === studentId);
    assert.equal(alice.obtained, 130);
    assert.equal(alice.total, 150);
    assert.equal(alice.percentage, 86.7);
    assert.equal(alice.grade, 'A');
    assert.equal(alice.status, 'Pass');
    assert.equal(alice.position, 1);
    if (others.length) {
      const o = sheet.students.find((s) => s.student_id === others[0]);
      assert.equal(o.status, 'Fail');
      assert.deepEqual(o.failed_subjects, ['Mathematics']);
    }
    assert.equal(sheet.can_approve, false, 'teachers cannot approve results');

    // Class teacher / principal remarks; teacher (subject teacher only) may not write them.
    const tRem = await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}/remarks`, { method: 'PUT', headers: TH, body: JSON.stringify({ remarks: [{ student_id: studentId, teacher_remarks: 'x' }] }) });
    assert.equal(tRem.status, 403);
    await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}/remarks`, {
      method: 'PUT', headers: H, body: JSON.stringify({ remarks: [{ student_id: studentId, teacher_remarks: 'Hard working', principal_remarks: 'شاباش، محنت جاری رکھیں' }] })
    });
    const appr = await (await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}/approve`, { method: 'POST', headers: H, body: JSON.stringify({ force: true }) })).json();
    assert.ok(appr.approved_by_name);
    const sheet2 = await (await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}`, { headers: H })).json();
    assert.equal(sheet2.students.find((s) => s.student_id === studentId).principal_remarks, 'شاباش، محنت جاری رکھیں');
    assert.ok(sheet2.approval);
    const cards = await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}/cards.pdf`, { headers: H });
    assert.equal(cards.status, 200);
    const one = await fetch(`${baseUrl}/api/results/terms/${term.id}/sections/${sectionId}/cards.pdf?student_id=${studentId}`, { headers: TH });
    assert.equal(one.status, 200);
    const ids2 = await fetch(`${baseUrl}/api/students/id-cards.pdf?section_id=${sectionId}`, { headers: H });
    assert.equal(ids2.status, 200);
  });

  await t.test('admissions, homework & syllabus, date sheet, events: create, scope and permissions', async () => {
    const H = authHeaders(token);
    const TH = authHeaders(teacherToken);
    const j = async (m, u, b, h = H) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

    // Admissions: enquiry -> student -> linked
    const enq = await j('POST', '/admissions/enquiries', { full_name: 'Zara Malik', class_id: classId, parent_phone: '03001234567', status: 'Test Scheduled', test_date: '2026-12-01' });
    assert.equal(enq.status, 201);
    assert.equal((await j('POST', '/admissions/enquiries', { full_name: 'X', status: 'Bogus' })).status, 400);
    assert.equal((await j('GET', '/admissions/enquiries', null, TH)).status, 403, 'teachers have no admissions access by default');
    const st = await j('POST', '/students', { full_name: 'Zara Malik', section_id: sectionId });
    assert.equal((await j('POST', `/admissions/enquiries/${enq.body.id}/admitted`, { student_id: st.body.id })).status, 200);
    const list = await j('GET', '/admissions/enquiries?status=Admitted');
    assert.ok(list.body.some((e) => e.id === enq.body.id && e.student_id === st.body.id));

    // Homework: teacher for their subject; not for a subject they don't teach
    const hw = await j('POST', '/homework/items', { section_id: sectionId, subject_id: subjectId, title: 'Exercise 3.2 Q1-5', due_date: '2099-01-01' }, TH);
    assert.equal(hw.status, 201);
    const other = await j('POST', '/academics/subjects', { name: 'Drawing' });
    assert.equal((await j('POST', '/homework/items', { section_id: sectionId, subject_id: other.body.id, title: 'x' }, TH)).status, 403);
    assert.equal((await j('POST', '/homework/items', { section_id: sectionId, subject_id: subjectId, title: 'x', assigned_on: '2026-11-10', due_date: '2026-11-01' }, TH)).status, 400);
    const mine = await j('GET', '/homework/my', null, TH);
    assert.ok(mine.body.some((h) => h.id === hw.body.id));
    const topic = await j('POST', '/homework/syllabus', { class_id: classId, subject_id: subjectId, unit: 'Ch 1', topic: 'Fractions' }, TH);
    assert.equal(topic.status, 201);
    await j('PUT', `/homework/syllabus/${topic.body.id}`, { status: 'Completed' }, TH);
    const topics = await j('GET', `/homework/syllabus?class_id=${classId}`, null, TH);
    const done = topics.body.find((x) => x.id === topic.body.id);
    assert.equal(done.status, 'Completed');
    assert.match(done.completed_on, /^\d{4}-\d{2}-\d{2}$/);
    const prog = await j('GET', '/homework/syllabus-progress', null, TH);
    assert.ok(prog.body.some((p) => p.class_id === classId && p.completed >= 1));

    // Date sheet: clash detection and PDF
    const p1 = await j('POST', '/datesheet/entries', { class_id: classId, subject_id: subjectId, exam_date: '2026-12-05', start_time: '09:00', end_time: '12:00' });
    assert.equal(p1.status, 201);
    const clash = await j('POST', '/datesheet/entries', { class_id: classId, subject_id: other.body.id, exam_date: '2026-12-05', start_time: '10:00', end_time: '11:00' });
    assert.equal(clash.status, 400);
    assert.equal((await j('POST', '/datesheet/entries', { class_id: classId, subject_id: other.body.id, exam_date: '2026-12-05', start_time: '12:30', end_time: '13:30' })).status, 201);
    const pdf = await fetch(`${baseUrl}/api/datesheet/print.pdf?class_id=${classId}`, { headers: H });
    assert.equal(pdf.status, 200);

    // Events: everyone sees "All"; staff-only events are hidden from parents (audience filter)
    const ev = await j('POST', '/events/items', { title: 'Sports Day', start_date: '2099-03-01', kind: 'Sports' });
    assert.equal(ev.status, 201);
    assert.equal((await j('POST', '/events/items', { title: 'x', start_date: '2099-03-01' }, TH)).status, 403);
    assert.equal((await j('POST', '/events/items', { title: 'x', start_date: '2099-03-05', end_date: '2099-03-01' })).status, 400);
    const up = await j('GET', '/events/upcoming?limit=50', null, TH);
    assert.ok(up.body.some((e) => e.id === ev.body.id));
  });

  await t.test('library, transport (billed with fees), inventory and accounting cash book', async () => {
    const H = authHeaders(token);
    const TH = authHeaders(teacherToken);
    const j = async (m, u, b, h = H) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

    // Library: copies limit, fine on late return
    const book = await j('POST', '/library/books', { title: 'Bang-e-Dra', author: 'Allama Iqbal', copies: 1 });
    assert.equal(book.status, 201);
    assert.equal((await j('POST', '/library/books', { title: 'x' }, TH)).status, 403, 'teachers can only view the library');
    await j('PUT', '/library/settings', { fine_per_day: 5, loan_days: 7 });
    const issue = await j('POST', '/library/issues', { book_id: book.body.id, borrower_type: 'student', borrower_id: studentId, issued_on: '2026-11-01', due_on: '2026-11-08' });
    assert.equal(issue.status, 201);
    assert.equal((await j('POST', '/library/issues', { book_id: book.body.id, borrower_type: 'teacher', borrower_id: teacherId })).status, 400, 'no copies left');
    const overdue = await j('GET', '/library/issues?status=overdue');
    assert.ok(overdue.body.some((i) => i.id === issue.body.id && i.late_days > 0));
    const ret = await j('POST', `/library/issues/${issue.body.id}/return`, { returned_on: '2026-11-10' });
    assert.equal(ret.body.fine, 10);

    // Transport: route fare added to the next invoice
    const v = await j('POST', '/transport/vehicles', { vehicle_no: 'LES-1234', capacity: 20, driver_name: 'Aslam' });
    const route = await j('POST', '/transport/routes', { name: 'Route 1', vehicle_id: v.body.id, monthly_fee: 1500, stops: 'Gate\nMarket' });
    assert.equal((await j('POST', '/transport/students', { student_id: studentId, route_id: route.body.id, stop: 'Market', start_date: '2026-01-01' })).status, 201);
    const onRoute = await j('GET', `/transport/students?route_id=${route.body.id}`);
    assert.equal(onRoute.body.length, 1);
    await j('POST', '/fees/invoices/generate-bulk', { section_id: sectionId, academic_year: '2026', period_label: 'Transport Test 2027', due_date: '2027-01-10' });
    const db = getDb();
    const inv = db.prepare(`SELECT fi.id FROM fee_invoices fi WHERE fi.student_id = ? AND fi.period_label = 'Transport Test 2027'`).get(studentId);
    assert.ok(inv, 'invoice created for the transport student');
    const line = db.prepare(`SELECT fii.amount FROM fee_invoice_items fii JOIN fee_heads fh ON fh.id = fii.fee_head_id WHERE fii.invoice_id = ? AND fh.name = 'Transport Fee'`).get(inv.id);
    assert.equal(line.amount, 1500);
    assert.equal((await j('DELETE', `/transport/routes/${route.body.id}`)).status, 400, 'route with students cannot be removed');

    // Inventory: stock in / out / count, cannot issue more than in stock
    const item = await j('POST', '/inventory/items', { name: 'Chalk box', unit: 'box', min_quantity: 5 });
    await j('POST', `/inventory/items/${item.body.id}/moves`, { kind: 'In', quantity: 10 });
    assert.equal((await j('POST', `/inventory/items/${item.body.id}/moves`, { kind: 'Out', quantity: 50 })).status, 400);
    const out = await j('POST', `/inventory/items/${item.body.id}/moves`, { kind: 'Out', quantity: 6, party: 'Class 1' });
    assert.equal(out.body.balance, 4);
    const low = await j('GET', '/inventory/items?low=1');
    assert.ok(low.body.some((i) => i.id === item.body.id && i.low_stock === 1));
    const count = await j('POST', `/inventory/items/${item.body.id}/moves`, { kind: 'Adjust', quantity: 7 });
    assert.equal(count.body.balance, 7);
    const moves = await j('GET', `/inventory/moves?item_id=${item.body.id}`);
    assert.equal(moves.body.length, 3);

    // Accounting: other income + cash book balance adds up
    const inc = await j('POST', '/accounts/income', { income_date: '2026-11-15', category: 'Donation', amount: 5000, received_from: 'Old Students Assoc.' });
    assert.equal(inc.status, 201);
    assert.equal((await j('POST', '/accounts/income', { category: 'Donation', amount: 100 }, TH)).status, 403);
    const book1 = await j('GET', '/accounts/daybook?from=2026-11-01&to=2026-11-30');
    assert.equal(book1.status, 200);
    assert.ok(book1.body.rows.some((r) => r.category === 'Donation' && r.money_in === 5000));
    assert.equal(Math.round((book1.body.opening + book1.body.total_in - book1.body.total_out) * 100) / 100, book1.body.closing);
    const sum = await j('GET', '/accounts/summary?from=2026-11-01&to=2026-11-30');
    assert.equal(Math.round((sum.body.total_income - sum.body.total_expenditure) * 100) / 100, sum.body.surplus);
    const xl = await fetch(`${baseUrl}/api/accounts/daybook?from=2026-11-01&to=2026-11-30&format=excel`, { headers: H });
    assert.equal(xl.status, 200);

    // New reports all respond
    for (const r of ['student-strength', 'student-directory', 'student-admissions', 'students-left', 'staff-attendance-summary', 'daily-absentees',
      'fee-defaulters', 'expense-by-category', 'transport-fees', 'result-summary', 'subject-averages', 'syllabus-coverage', 'library-overdue', 'inventory-stock']) {
      const res = await fetch(`${baseUrl}/api/reports/${r}`, { headers: H });
      assert.equal(res.status, 200, r);
    }
    const strength = await (await fetch(`${baseUrl}/api/reports/student-strength`, { headers: H })).json();
    assert.equal(strength[strength.length - 1].class_name, 'TOTAL');

    const logs = await j('GET', '/settings/audit-logs?action=issue_book');
    assert.ok(logs.body.rows.length >= 1);
    assert.ok(logs.body.facets.actions.includes('issue_book'));
  });

  await t.test('fees: extra charges, no double billing, arrears on vouchers, oldest-first payment, families, auto monthly run', async () => {
    const H = authHeaders(token);
    const j = async (m, u, b) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const db = getDb();
    // Two siblings under one parent
    const a = await j('POST', '/students', { full_name: 'Ali Sibling', section_id: sectionId, parent_name: 'Family Father', parent_phone: '03111111111' });
    const parentId = db.prepare('SELECT parent_id FROM students WHERE id = ?').get(a.body.id).parent_id;
    const b2 = await j('POST', '/students', { full_name: 'Sara Sibling', section_id: sectionId });
    db.prepare('UPDATE students SET parent_id = ? WHERE id = ?').run(parentId, b2.body.id);

    const gen = await j('POST', '/fees/invoices/generate-bulk', { section_id: sectionId, academic_year: '2026', period_label: 'Arrears Month 1', due_date: '2027-02-10', include_transport: false,
      extra_items: [{ name: 'Trip Fee', amount: 500 }] });
    assert.equal(gen.status, 200);
    assert.ok(gen.body.created >= 2);
    const again = await j('POST', '/fees/invoices/generate-bulk', { section_id: sectionId, academic_year: '2026', period_label: 'Arrears Month 1', due_date: '2027-02-10', include_transport: false });
    assert.equal(again.body.created, 0, 'same month is never billed twice');
    assert.ok(again.body.skipped >= 2);
    const trip = db.prepare(`SELECT fii.amount FROM fee_invoice_items fii JOIN fee_invoices fi ON fi.id = fii.invoice_id JOIN fee_heads fh ON fh.id = fii.fee_head_id
      WHERE fi.student_id = ? AND fi.period_label = 'Arrears Month 1' AND fh.name = 'Trip Fee'`).get(a.body.id);
    assert.equal(trip.amount, 500);
    await j('POST', '/fees/invoices/generate-bulk', { section_id: sectionId, academic_year: '2026', period_label: 'Arrears Month 2', due_date: '2027-03-10', include_transport: false, extra_items: [{ name: 'Fine', amount: 100 }] });

    const inv2 = db.prepare(`SELECT id FROM fee_invoices WHERE student_id = ? AND period_label = 'Arrears Month 2'`).get(a.body.id);
    const v = await fetch(`${baseUrl}/api/fees/invoices/${inv2.id}/voucher.pdf`, { headers: H });
    assert.equal(v.status, 200);
    const bulk = await fetch(`${baseUrl}/api/fees/vouchers.pdf?period_label=${encodeURIComponent('Arrears Month 2')}&section_id=${sectionId}&family=1`, { headers: H });
    assert.equal(bulk.status, 200);

    // Student dues include arrears; paying applies oldest first
    const dues = await j('GET', `/fees/students/${a.body.id}/dues`);
    assert.equal(dues.body.invoices.length, 2);
    assert.equal(dues.body.invoices[0].period_label, 'Arrears Month 1');
    const firstBal = dues.body.invoices[0].balance;
    const tooMuch = await j('POST', `/fees/students/${a.body.id}/pay-dues`, { amount: dues.body.total + 1 });
    assert.equal(tooMuch.status, 400);
    const paid = await j('POST', `/fees/students/${a.body.id}/pay-dues`, { amount: firstBal + 50, payment_method: 'Cash' });
    assert.equal(paid.status, 201);
    assert.equal(paid.body.payments.length, 2);
    assert.equal(db.prepare(`SELECT status FROM fee_invoices WHERE student_id = ? AND period_label = 'Arrears Month 1'`).get(a.body.id).status, 'Paid');
    assert.equal(db.prepare(`SELECT status FROM fee_invoices WHERE id = ?`).get(inv2.id).status, 'Partial');
    const rc = await fetch(`${baseUrl}/api/fees/receipts/combined.pdf?ids=${paid.body.payments.map((p) => p.id).join(',')}`, { headers: H });
    assert.equal(rc.status, 200);

    // Family: one voucher and one payment for both children
    const fams = await j('GET', '/fees/families?search=Family%20Father');
    assert.ok(fams.body.some((f) => f.id === parentId && f.children === 2));
    const fam = await j('GET', `/fees/families/${parentId}`);
    assert.equal(fam.body.children.length, 2);
    const famPdf = await fetch(`${baseUrl}/api/fees/families/${parentId}/voucher.pdf`, { headers: H });
    assert.equal(famPdf.status, 200);
    const famPay = await j('POST', `/fees/families/${parentId}/pay`, { amount: fam.body.total });
    assert.equal(famPay.status, 201);
    assert.equal((await j('GET', `/fees/families/${parentId}`)).body.total, 0);

    // Student history: totals add up
    const h = await j('GET', `/students/${a.body.id}/history`);
    assert.equal(h.body.fees.totals.balance, 0);
    assert.equal(Math.round((h.body.fees.totals.billed - h.body.fees.totals.paid) * 100) / 100, 0);
    assert.equal(h.body.fees.ledger[h.body.fees.ledger.length - 1].balance, 0);
    const st = await fetch(`${baseUrl}/api/students/${a.body.id}/statement.pdf`, { headers: H });
    assert.equal(st.status, 200);
    const byClass = await j('GET', `/students?class_id=${classId}&sort=class&limit=500`);
    assert.ok(byClass.body.rows.length >= 2);

    // Auto monthly fees: run now twice — second run creates nothing
    await j('PUT', '/fees/auto-settings', { auto_fee_enabled: 'true', auto_fee_day: '1', auto_fee_due_day: '10', auto_fee_academic_year: '2026' });
    const r1 = await j('POST', '/fees/auto-run-now', {});
    assert.equal(r1.status, 200);
    assert.ok(r1.body.month);
    const r2 = await j('POST', '/fees/auto-run-now', {});
    assert.equal(r2.body.created, 0);
    await j('PUT', '/fees/auto-settings', { auto_fee_enabled: 'false' });
  });

  await t.test('reports can be sent; results send-all; cloud backup to a Drive folder; daily scheduler', async () => {
    const H = authHeaders(token);
    const noTo = await fetch(`${baseUrl}/api/reports/student-strength?format=send`, { headers: H });
    assert.equal(noTo.status, 400);
    const sent = await (await fetch(`${baseUrl}/api/reports/student-strength?format=send&phone=03001234567&class_id=${classId}`, { headers: H })).json();
    assert.ok(sent.summary, 'returns a delivery summary');
    const prog = await (await fetch(`${baseUrl}/api/results/sections/${sectionId}/progress/send-all`, { method: 'POST', headers: H, body: JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }) })).json();
    assert.ok(prog.students >= 1);

    // Google Drive via a synced folder (Google Drive for desktop)
    const driveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdrive-'));
    await fetch(`${baseUrl}/api/settings/cloud-backup`, { method: 'PUT', headers: H, body: JSON.stringify({ mode: 'folder', folder_path: driveDir, keep: 2, client_secret: 'top-secret' }) });
    const up = await fetch(`${baseUrl}/api/settings/gdrive/backup-now`, { method: 'POST', headers: H, body: '{}' });
    assert.equal(up.status, 200);
    const files = fs.readdirSync(path.join(driveDir, 'CHAND School Backups'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^CHAND-backup-.*\.zip$/);
    // Restore list (like WhatsApp's Restore) sees the Drive backups; bad ids are refused
    const listed = await (await fetch(`${baseUrl}/api/settings/gdrive/backups`, { headers: H })).json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, files[0]);
    assert.ok(listed[0].size > 0);
    const badRestore = await fetch(`${baseUrl}/api/settings/gdrive/restore`, { method: 'POST', headers: H, body: JSON.stringify({ id: '../../sms.db' }) });
    assert.equal(badRestore.status, 400);
    const notAdmin = await fetch(`${baseUrl}/api/settings/gdrive/restore`, { method: 'POST', headers: authHeaders(teacherToken), body: JSON.stringify({ id: files[0] }) });
    assert.ok([401, 403].includes(notAdmin.status));

    // WhatsApp-style schedule: daily / weekly / monthly / only when tapped
    const cloud = require('../server/src/services/cloudBackup');
    const gdb = getDb();
    const freq = async (f) => (await fetch(`${baseUrl}/api/settings/cloud-backup`, { method: 'PUT', headers: H, body: JSON.stringify({ frequency: f, time: '20:00' }) })).status;
    assert.equal(await freq('hourly'), 400);
    const lastOk = (at) => gdb.prepare("INSERT INTO settings (key, value) VALUES ('gdrive_last_ok', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ok: true, at }));
    const at = (d) => new Date(`${d}T21:00:00`);
    assert.equal(await freq('daily'), 200);
    lastOk('2026-11-20 20:00:05');
    assert.equal(cloud.driveBackupDue(gdb, new Date('2026-11-20T23:00:00')), false, 'already done today');
    assert.equal(cloud.driveBackupDue(gdb, new Date('2026-11-21T19:00:00')), false, 'not before the set time');
    assert.equal(cloud.driveBackupDue(gdb, at('2026-11-21')), true);
    await freq('weekly');
    assert.equal(cloud.driveBackupDue(gdb, at('2026-11-25')), false);
    assert.equal(cloud.driveBackupDue(gdb, at('2026-11-27')), true);
    await freq('monthly');
    assert.equal(cloud.driveBackupDue(gdb, at('2026-12-10')), false);
    assert.equal(cloud.driveBackupDue(gdb, at('2026-12-20')), true);
    await freq('manual');
    assert.equal(cloud.driveBackupDue(gdb, at('2027-05-01')), false);
    gdb.prepare("DELETE FROM settings WHERE key = 'gdrive_last_ok'").run();

    // Built-in Google sign-in: Connect works with no setup, using PKCE
    process.env.CHAND_GDRIVE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    cloud.resetBuiltInCache();
    await fetch(`${baseUrl}/api/settings/cloud-backup`, { method: 'PUT', headers: H, body: JSON.stringify({ mode: 'api', client_id: '' }) });
    const cb = await (await fetch(`${baseUrl}/api/settings/cloud-backup`, { headers: H })).json();
    assert.equal(cb.built_in, true);
    assert.equal(cb.can_connect, true);
    assert.equal(cb.connected, false);
    const au = await (await fetch(`${baseUrl}/api/settings/gdrive/auth-url`, { headers: H })).json();
    const u = new URL(au.url);
    assert.equal(u.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/api\/gdrive\/callback$/);
    const forged = await fetch(`${baseUrl}/api/gdrive/callback?code=x&state=not-ours`);
    assert.equal(forged.status, 400);
    delete process.env.CHAND_GDRIVE_CLIENT_ID;
    cloud.resetBuiltInCache();
    const pub = await (await fetch(`${baseUrl}/api/settings`, { headers: authHeaders(teacherToken) })).json();
    assert.equal(pub.gdrive_client_secret, undefined, 'secrets are never sent to the browser');
    const bad = await fetch(`${baseUrl}/api/settings/cloud-backup`, { method: 'PUT', headers: H, body: JSON.stringify({ mode: 'folder', folder_path: path.join(driveDir, 'missing') }) });
    assert.equal(bad.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/settings/gdrive/backup-now`, { method: 'POST', headers: H, body: '{}' })).status, 400);
    await fetch(`${baseUrl}/api/settings/cloud-backup`, { method: 'PUT', headers: H, body: JSON.stringify({ mode: '' }) });

    // Scheduler: daily local backup runs once per day
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('local_backup_time', '00:00') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    db.prepare("DELETE FROM settings WHERE key = 'local_backup_last'").run();
    const scheduler = require('../server/src/services/scheduler');
    const before = require('../server/src/services/backup').listBackups().filter((x) => x.fileName.startsWith('auto-daily-')).length;
    await scheduler.tick(new Date());
    await scheduler.tick(new Date());
    const after = require('../server/src/services/backup').listBackups().filter((x) => x.fileName.startsWith('auto-daily-')).length;
    assert.equal(after, before + 1);
  });

  await t.test('homework diary and syllabus can be shared on WhatsApp to parents and the class group', async () => {
    const H = authHeaders(token);
    const TH = authHeaders(teacherToken);
    const j = async (m, u, b, h = H) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const day = '2026-11-20';
    await j('POST', '/homework/items', { section_id: sectionId, subject_id: subjectId, title: 'Read chapter 4', details: 'Answer Q1 to Q3', assigned_on: day, due_date: '2026-11-22' }, TH);
    // Parent with a phone, plus a sibling under the same parent (counted once)
    const kid = await j('POST', '/students', { full_name: 'Diary Kid', section_id: sectionId, parent_name: 'Diary Parent', parent_phone: '03009998887' });
    const pid = getDb().prepare('SELECT parent_id FROM students WHERE id = ?').get(kid.body.id).parent_id;
    const sib = await j('POST', '/students', { full_name: 'Diary Sibling', section_id: sectionId });
    getDb().prepare('UPDATE students SET parent_id = ? WHERE id = ?').run(pid, sib.body.id);

    const pv = await j('POST', '/homework/share/preview', { kind: 'diary', section_id: sectionId, date: day }, TH);
    assert.equal(pv.status, 200);
    assert.match(pv.body.text, /Daily Diary/);
    assert.match(pv.body.text, /Read chapter 4/);
    assert.match(pv.body.text, /submit by 22 Nov 2026/);
    assert.equal(pv.body.sections.length, 1);
    const phones = getDb().prepare(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT p.phone FROM students s JOIN parents p ON p.id = s.parent_id
      WHERE s.section_id = ? AND s.archived = 0 AND s.left_on IS NULL AND TRIM(COALESCE(p.phone, '')) <> '')`).get(sectionId).n;
    assert.equal(pv.body.sections[0].parents, phones, 'siblings share one parent message');
    assert.equal((await j('POST', '/homework/share/preview', { kind: 'diary', section_id: sectionId, date: '2001-01-01' }, TH)).status, 400, 'no homework that day');

    const one = await j('POST', '/homework/share/preview', { kind: 'homework', homework_id: (await j('GET', `/homework/items?section_id=${sectionId}&from=${day}&to=${day}`)).body[0].id });
    assert.match(one.body.text, /Submit by/);
    await j('POST', '/homework/syllabus', { class_id: classId, subject_id: subjectId, unit: 'Ch 2', topic: 'Decimals', status: 'Completed' });
    const sy = await j('POST', '/homework/share/preview', { kind: 'syllabus', class_id: classId });
    assert.equal(sy.status, 200);
    assert.match(sy.body.text, /✅ Ch 2: Decimals/);

    // Not linked: sending refuses with a clear message (the page offers "Open in WhatsApp")
    const send = await j('POST', '/homework/share/send', { kind: 'diary', section_id: sectionId, date: day, to_parents: true }, TH);
    assert.equal(send.status, 400);
    assert.match(send.body.error || send.body.message || '', /not linked/);

    // Class group mapping: only real group ids; teachers only for their classes
    assert.equal((await j('PUT', `/homework/share/groups/${sectionId}`, { id: '923001234567@s.whatsapp.net' })).status, 400);
    const map = await j('PUT', `/homework/share/groups/${sectionId}`, { id: '120363000000000001@g.us', name: 'Class Parents' });
    assert.equal(map.status, 200);
    assert.equal((await j('POST', '/homework/share/preview', { kind: 'diary', section_id: sectionId, date: day })).body.sections[0].group.name, 'Class Parents');
    const otherSec = await j('POST', '/academics/sections', { class_id: classId, name: 'Z' });
    assert.equal((await j('PUT', `/homework/share/groups/${otherSec.body.id}`, { id: '120363000000000002@g.us' }, TH)).status, 403);
    const groups = await j('GET', '/homework/share/groups', null, TH);
    assert.equal(groups.status, 200);
    assert.equal(groups.body.status === 'connected', false);
  });

  await t.test('fees: discount marks Paid, extra becomes advance used on the next voucher, single-student voucher, KPIs, multi-print', async () => {
    const H = authHeaders(token);
    const j = async (m, u, b) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const db = getDb();
    const st = await j('POST', '/students', { full_name: 'Advance Kid', section_id: sectionId });
    const sid = st.body.id;
    const before = (await j('GET', '/fees/summary')).body;

    // Single-student voucher with only extra charges
    const one = await j('POST', '/fees/invoices/generate-bulk', { student_id: sid, academic_year: '2026', period_label: 'Disc Month', due_date: '2027-05-10', class_fees: false, extra_items: [{ name: 'Tuition Fee', amount: 3000 }] });
    assert.equal(one.status, 200);
    assert.equal(one.body.created, 1);
    const inv = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(one.body.invoiceIds[0]);
    assert.equal(inv.student_id, sid);
    assert.equal(inv.total_amount, 3000);

    // 2500 cash + 500 discount → Paid (not Partial)
    const pay = await j('POST', `/fees/invoices/${inv.id}/pay`, { amount: 2500, discount: 500 });
    assert.equal(pay.status, 201);
    assert.equal(pay.body.status, 'Paid');
    let row = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(inv.id);
    assert.equal(row.concession_amount, 500);
    assert.equal(row.total_amount, 2500);
    const rcpt = await fetch(`${baseUrl}/api/fees/payments/${pay.body.id}/receipt.pdf`, { headers: H });
    assert.equal(rcpt.status, 200);

    // Voiding the payment brings the discount back off
    await j('POST', `/fees/payments/${pay.body.id}/void`, { reason: 'test' });
    row = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(inv.id);
    assert.equal(row.total_amount, 3000);
    assert.equal(row.status, 'Pending');

    // Paying 5000 on a 3000 voucher keeps 2000 as advance
    const over = await j('POST', `/fees/invoices/${inv.id}/pay`, { amount: 5000 });
    assert.equal(over.status, 201);
    assert.equal(over.body.advance, 2000);
    assert.equal((await j('GET', `/fees/students/${sid}/advance`)).body.balance, 2000);

    // Next voucher is paid from the advance automatically
    const next = await j('POST', '/fees/invoices/generate-bulk', { student_id: sid, academic_year: '2026', period_label: 'Adv Month', due_date: '2027-06-10', class_fees: false, extra_items: [{ name: 'Tuition Fee', amount: 1500 }] });
    const nextInv = db.prepare('SELECT * FROM fee_invoices WHERE id = ?').get(next.body.invoiceIds[0]);
    assert.equal(nextInv.status, 'Paid');
    assert.equal(nextInv.paid_amount, 1500);
    assert.equal((await j('GET', `/fees/students/${sid}/advance`)).body.balance, 500);
    const vpdf = await fetch(`${baseUrl}/api/fees/invoices/${nextInv.id}/voucher.pdf`, { headers: H });
    assert.equal(vpdf.status, 200);

    // Advance received with no voucher, then pay-dues with extra kept as advance
    const adv = await j('POST', `/fees/students/${sid}/advance`, { amount: 700 });
    assert.equal(adv.status, 201);
    assert.equal(adv.body.balance, 1200);
    assert.equal((await fetch(`${baseUrl}/api/fees/advances/${adv.body.id}/receipt.pdf`, { headers: H })).status, 200);

    // KPIs: discounts and advance; cash counted once (advance used is not new cash)
    const after = (await j('GET', '/fees/summary')).body;
    assert.equal(Math.round((after.advance - before.advance) * 100) / 100, 1200);
    assert.equal(Math.round((after.collected - before.collected) * 100) / 100, 3000, '3000 cash on the voucher (5000 minus 2000 advance)');
    const fin = (await j('GET', '/dashboard/finance?period=custom&from=2000-01-01&to=2100-01-01')).body;
    assert.ok(fin.discounts && typeof fin.discounts.total === 'number');

    // Print only the ticked vouchers, 3 per page
    const sel = await fetch(`${baseUrl}/api/fees/vouchers.pdf?ids=${inv.id},${nextInv.id}&per_page=3`, { headers: H });
    assert.equal(sel.status, 200);
  });

  await t.test('teacher & staff father name, new staff designations, ID cards, inventory opening stock', async () => {
    const H = authHeaders(token);
    const j = async (m, u, b) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const db = getDb();
    const tch = await j('POST', '/teachers', { full_name: 'Card Teacher', father_name: 'Card Father', designation: 'Senior Teacher' });
    assert.equal(tch.status, 201);
    assert.equal(db.prepare('SELECT father_name FROM teachers WHERE id = ?').get(tch.body.id).father_name, 'Card Father');
    await j('PUT', `/teachers/${tch.body.id}`, { father_name: 'Changed Father' });
    assert.equal(db.prepare('SELECT father_name FROM teachers WHERE id = ?').get(tch.body.id).father_name, 'Changed Father');
    const cats = (await j('GET', '/staff/categories')).body.map((c) => c.name);
    for (const n of ['Accountant', 'Receptionist', 'IT Assistant', 'Store Keeper', 'Librarian Assistant', 'School Driver']) assert.ok(cats.includes(n), n);
    const catId = (await j('GET', '/staff/categories')).body.find((c) => c.name === 'Receptionist').id;
    const stf = await j('POST', '/staff', { full_name: 'Card Staff', father_name: 'Staff Father', category_id: catId });
    assert.equal(db.prepare('SELECT father_name FROM staff WHERE id = ?').get(stf.body.id).father_name, 'Staff Father');
    const tc = await fetch(`${baseUrl}/api/teachers/id-cards.pdf?ids=${tch.body.id}`, { headers: H });
    assert.equal(tc.status, 200);
    assert.equal(tc.headers.get('content-type'), 'application/pdf');
    assert.equal((await fetch(`${baseUrl}/api/staff/id-cards.pdf`, { headers: H })).status, 200);

    const bad = await j('POST', '/inventory/items', { name: 'Desks', unit: '200' });
    assert.equal(bad.status, 400);
    const item = await j('POST', '/inventory/items', { name: 'Desks', unit: 'pcs', opening_stock: 200 });
    assert.equal(item.status, 201);
    assert.equal(db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(item.body.id).quantity, 200);

    const rep = await fetch(`${baseUrl}/api/reports/attendance-summary?format=pdf&section_id=${sectionId}`, { headers: H });
    assert.equal(rep.status, 200);
  });

  await t.test('fee heads: common list ready, free text adds a head once, no look-alike duplicates', async () => {
    const H = authHeaders(token);
    const j = async (m, u, b, h = H) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const names = (await j('GET', '/fees/heads')).body.map((h) => h.name.toLowerCase());
    for (const n of ['transport', 'library', 'fine', 'trip', 'exam', 'late fee']) {
      assert.ok(names.some((x) => x === n || x === `${n} fee`), `common head "${n}" is ready`);
    }
    const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM fee_heads').get().n;
    const before = count();
    // Same head written differently is not added again
    const dup = await j('POST', '/fees/heads', { name: '  TRANSPORT fees ' });
    assert.equal(dup.body.existed, true);
    assert.equal(count(), before);
    // A new name typed in the fee structure form becomes a head, once
    const st = await j('POST', '/fees/structures', { class_id: classId, fee_head_name: 'Uniform Charges', amount: 1500, frequency: 'OneTime', academic_year: '2031' });
    assert.equal(st.status, 200);
    assert.equal(count(), before + 1);
    await j('POST', '/fees/structures', { class_id: classId, fee_head_name: 'uniform charges', amount: 1600, frequency: 'OneTime', academic_year: '2031' });
    assert.equal(count(), before + 1);
    const row = getDb().prepare(`SELECT fs.amount FROM fee_structures fs JOIN fee_heads fh ON fh.id = fs.fee_head_id WHERE fh.name = 'Uniform Charges' AND fs.academic_year = '2031'`).get();
    assert.equal(row.amount, 1600, 'same head updated, not a second line');
    assert.equal((await j('POST', '/fees/structures', { class_id: classId, amount: 10, academic_year: '2031' })).status, 400);
    // Renaming onto an existing head is refused
    const uni = getDb().prepare("SELECT id FROM fee_heads WHERE name = 'Uniform Charges'").get();
    assert.equal((await j('PUT', `/fees/heads/${uni.id}`, { name: 'Fine' })).status, 400);
    // Invoice fee lines accept a typed head
    const inv = getDb().prepare("SELECT id FROM fee_invoices WHERE status <> 'Cancelled' AND id NOT IN (SELECT invoice_id FROM fee_payments) ORDER BY id DESC LIMIT 1").get();
    const ed = await j('PUT', `/fees/invoices/${inv.id}`, { items: [{ fee_head_name: 'Science Project Fee', amount: 300, discount_amount: 0 }] });
    assert.equal(ed.status, 200);
    assert.ok(getDb().prepare("SELECT id FROM fee_heads WHERE name = 'Science Project Fee'").get());
    // Missing common heads can be put back
    assert.equal((await j('POST', '/fees/heads/common', {})).body.added, 0);
  });

  await t.test('student bulk import: sample row, per-class Sr No, loose class names, classes created from the sheet', async () => {
    const ExcelJS = require('exceljs');
    const H = authHeaders(token);
    const tpl = await fetch(`${baseUrl}/api/students/import/template`, { headers: H });
    assert.equal(tpl.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()));
    const sheet = wb.getWorksheet('Students');
    assert.ok(wb.getWorksheet('Classes & Sections') && wb.getWorksheet('How to fill'));
    assert.equal(sheet.getCell('A1').value, 'Sr No (in class)');
    assert.match(String(sheet.getCell('B2').value), /^Sample Student/);
    assert.ok(sheet.getCell('A3').value.formula.includes('COUNTIF'));
    const db = getDb();
    if (!db.prepare("SELECT id FROM classes WHERE name = 'Class 3'").get()) {
      const cid = Number(db.prepare("INSERT INTO classes (name, sort_order) VALUES ('Class 3', 3)").run().lastInsertRowid);
      db.prepare("INSERT INTO sections (class_id, name) VALUES (?, 'A')").run(cid);
    }
    const cls = { name: 'Class 3', sec: 'A' };
    // Like a Google Sheets download: class typed as "1", date as a real date, phone lost its 0
    sheet.getRow(3).values = [1, 'Ibtesam Import', 'male', new Date(Date.UTC(2015, 1, 16)), 3, 'a', 101, 'Asif', 3063124394, { text: 'asif@gmail.com', hyperlink: 'mailto:asif@gmail.com' }, 'New Hyder Colony'];
    sheet.getRow(4).values = [2, 'Sibling Import', 'F', '16/03/2017', cls.name, cls.sec, 102, 'Asif', '03063124394', '', ''];
    sheet.getRow(5).values = [1, 'Nursery Kid', 'Male', '2021-01-05', 'Play Group', 'Rose', 1, 'Bilal', '0301-5556667', '', ''];
    sheet.getRow(6).values = [2, 'Bad Date', 'Male', '2015-02-31', cls.name, cls.sec, 3, '', '', '', ''];
    sheet.getRow(7).values = [3, 'Same Roll', 'Male', '2015-05-05', cls.name, cls.sec, 101, '', '', '', ''];
    const up = async () => { const fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'students.xlsx'); const r = await fetch(`${baseUrl}/api/students/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); return { status: r.status, body: await r.json() }; };
    const r1 = await up();
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.created, 3, JSON.stringify(r1.body));
    assert.equal(r1.body.failed.length, 2);
    assert.equal(r1.body.failed[0].row, 6);
    assert.equal(r1.body.failed[1].error, 'Roll number 101 is already given to Ibtesam Import in Class 3 - A. Please use a different roll number, or leave it empty.');
    assert.ok(r1.body.skipped.some((x) => x.reason === 'Sample row'));
    assert.deepEqual(r1.body.createdClasses, ['Play Group']);
    assert.deepEqual(r1.body.createdSections, ['Play Group - ROSE']);
    assert.ok(r1.body.byClass.some((c) => c.name === `${cls.name} - ${cls.sec}` && c.count === 2));
    const kid = db.prepare("SELECT * FROM students WHERE full_name = 'Ibtesam Import'").get();
    assert.equal(kid.date_of_birth, '2015-02-16');
    assert.equal(kid.gender, 'Male');
    const sib = db.prepare("SELECT * FROM students WHERE full_name = 'Sibling Import'").get();
    assert.equal(sib.date_of_birth, '2017-03-16');
    assert.equal(sib.parent_id, kid.parent_id, 'siblings share one guardian by phone');
    assert.equal(db.prepare('SELECT phone FROM parents WHERE id = ?').get(kid.parent_id).phone, '03063124394');
    // Uploading the same file again adds nobody twice
    const r2 = await up();
    assert.equal(r2.body.created, 0);
    assert.equal(r2.body.createdClasses.length, 0);
  });

  // Must stay last: it rewinds the database to an earlier point.
  await t.test('dashboard KPIs, class-wise outstanding, my profile, school picture and certificates', async () => {
    const H = authHeaders(token);
    const j = async (m, u, b, h = H) => { const r = await fetch(`${baseUrl}/api${u}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

    const dash = (await j('GET', '/dashboard/admin')).body;
    for (const k of ['classCount', 'sectionCount', 'attendanceToday', 'feeBilledMonth', 'pendingStudents', 'monthly', 'recentActivities']) assert.ok(k in dash, k);
    assert.equal(dash.monthly.length, 6);

    // A teacher never sees fee collections, dues or fee / expense history.
    const tH = authHeaders(teacherToken);
    const tDash = (await j('GET', '/dashboard/admin', null, tH)).body;
    assert.equal(tDash.feeCollectionMonth, null);
    assert.equal(tDash.pendingDues, null);
    assert.equal(tDash.monthly.length, 0);
    assert.ok(!tDash.recentActivities.some((x) => x.kind === 'fee' || x.kind === 'expense'));
    assert.equal((await j('GET', '/dashboard/accountant', null, tH)).status, 403);
    assert.equal((await j('GET', '/dashboard/outstanding', null, tH)).status, 403);
    assert.equal((await j('GET', '/dashboard/finance', null, tH)).status, 403);
    assert.equal((await j('POST', '/certificates', { category: 'appreciation', recipient_name: 'X' }, tH)).status, 403);

    const out = (await j('GET', '/dashboard/outstanding')).body;
    assert.ok(Array.isArray(out.classes));
    const sum = Math.round(out.classes.reduce((a, c) => a + c.outstanding, 0) * 100) / 100;
    assert.equal(sum, out.total);
    assert.equal(Math.round(out.total), Math.round(dash.pendingDues), 'breakdown adds up to the outstanding KPI');
    out.classes.forEach((c) => assert.equal(Math.round(c.sections.reduce((a, x) => a + x.outstanding, 0)), Math.round(c.outstanding)));

    // Profile: name / phone / email, bad values refused, photo upload + remove
    assert.equal((await j('PUT', '/auth/profile', { full_name: 'Admin Person', phone: '0300-1112223', email: 'admin@school.test' })).status, 200);
    let me = (await j('GET', '/auth/me')).body;
    assert.equal(me.phone, '0300-1112223');
    assert.equal(me.full_name, 'Admin Person');
    assert.equal((await j('PUT', '/auth/profile', { full_name: 'X', email: 'not-an-email' })).status, 400);
    assert.equal((await j('PUT', '/auth/profile', { full_name: '' })).status, 400);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex');
    const up = async (url, field, name) => { const fd = new FormData(); fd.append(field, new Blob([png], { type: 'image/png' }), name); const r = await fetch(`${baseUrl}/api${url}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); return { status: r.status, body: await r.json() }; };
    const ph = await up('/auth/profile/photo', 'photo', 'me.png');
    assert.equal(ph.status, 201);
    me = (await j('GET', '/auth/me')).body;
    assert.equal(me.photo, ph.body.photo);
    assert.equal((await j('DELETE', '/auth/profile/photo')).status, 200);
    assert.equal((await j('GET', '/auth/me')).body.photo, null);

    // School picture
    const pic = await up('/settings/school-picture', 'picture', 'campus.png');
    assert.equal(pic.status, 201);
    assert.equal((await j('GET', '/settings')).body.school_picture, pic.body.file);
    assert.equal((await j('DELETE', '/settings/school-picture')).status, 200);
    assert.equal((await j('GET', '/settings')).body.school_picture, '');

    // School stamps: upload / placement / remove; PNG/JPG only; stamped PDFs render
    let st = (await j('GET', '/settings/stamps')).body;
    assert.deepEqual(st.kinds, ['official', 'principal', 'paid', 'approved']);
    assert.equal(st.usage.fee_receipts, 'paid');
    assert.equal(st.stamps.official, null);
    const seal = await up('/settings/stamps/official', 'stamp', 'seal.png');
    assert.equal(seal.status, 201);
    assert.equal((await up('/settings/stamps/bogus', 'stamp', 'x.png')).status, 400);
    assert.equal((await up('/settings/stamps/paid', 'stamp', 'x.webp')).status, 400);
    assert.equal((await j('PUT', '/settings/stamps/usage', { certificates: 'official', fee_receipts: 'nope' })).status, 400);
    assert.equal((await j('PUT', '/settings/stamps/usage', { certificates: 'official', notices: 'official', fee_receipts: '' })).status, 200);
    st = (await j('GET', '/settings/stamps')).body;
    assert.equal(st.stamps.official, seal.body.file);
    assert.equal(st.usage.fee_receipts, '');
    assert.equal(st.usage.result_cards, '', 'docs left out of the saved placement print no stamp');
    {
      const pdfSvc = require('../server/src/services/pdf');
      const sp = path.join(config.uploadsDir, seal.body.file);
      const buf = await pdfSvc.noticePdf({ schoolName: 'T', title: 'Stamp test', message: 'Hello', stampPath: sp });
      assert.ok(buf.length > 500);
    }
    assert.equal((await j('DELETE', '/settings/stamps/official')).status, 200);
    assert.equal((await j('GET', '/settings/stamps')).body.stamps.official, null);

    // Certificates: serial numbers per type, position validated, one active leaving certificate per student
    const a = await j('POST', '/certificates', { category: 'position', template: 'classic', student_id: studentId, recipient_name: 'Alice', data: { position: '1st', event: 'Annual Exam' } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.match(a.body.certificate_number, /^POS-\d{4}-0001$/);
    const b = await j('POST', '/certificates', { category: 'position', template: 'royal', recipient_name: 'Bob', data: { position: '2nd' } });
    assert.match(b.body.certificate_number, /-0002$/);
    assert.equal((await j('POST', '/certificates', { category: 'position', recipient_name: 'C', data: { position: '4th' } })).status, 400);
    assert.equal((await j('POST', '/certificates', { category: 'nope', recipient_name: 'C' })).status, 400);
    assert.equal((await j('POST', '/certificates', { category: 'character', template: 'fancy', recipient_name: 'C' })).status, 400);
    const lc = await j('POST', '/certificates', { category: 'leaving', template: 'modern', student_id: studentId, recipient_name: 'Alice', data: { conduct: 'Good' } });
    assert.match(lc.body.certificate_number, /^LC-\d{4}-0001$/);
    assert.equal((await j('POST', '/certificates', { category: 'leaving', student_id: studentId, recipient_name: 'Alice' })).status, 409);
    assert.equal((await j('POST', `/certificates/${lc.body.id}/cancel`, { reason: 'typo' })).status, 200);
    assert.equal((await j('POST', '/certificates', { category: 'leaving', student_id: studentId, recipient_name: 'Alice' })).status, 201, 'reissue after cancelling');
    const reg = (await j('GET', '/certificates?category=leaving')).body;
    assert.equal(reg.length, 2);
    assert.ok(reg.some((r) => r.cancelled_at && r.cancel_reason === 'typo'));
    assert.equal((await j('GET', `/certificates/student/${studentId}`)).status, 200);
    assert.ok((await j('GET', '/certificates/students')).body.length > 0);
  });

  await t.test('full backup .zip can be restored from an external file; bad files are rejected; license survives', async () => {
    const zipRes = await fetch(`${baseUrl}/api/settings/backups/full.zip`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(zipRes.status, 200);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipBuf.subarray(0, 2).toString(), 'PK');

    const extra = await (await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify({ full_name: 'After Backup', section_id: sectionId })
    })).json();
    assert.ok(extra.id);

    const junk = new FormData();
    junk.append('backup', new Blob(['not a database']), 'fake.db');
    const junkRes = await fetch(`${baseUrl}/api/settings/backups/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: junk });
    assert.equal(junkRes.status, 400);

    const form = new FormData();
    form.append('backup', new Blob([zipBuf]), 'CHAND-full-backup.zip');
    form.append('restore', 'true');
    const restoreRes = await fetch(`${baseUrl}/api/settings/backups/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const restoreBody = await restoreRes.json();
    assert.equal(restoreRes.status, 200, restoreBody.error);
    assert.equal(restoreBody.restored, true);
    assert.ok(restoreBody.preRestoreBackup.startsWith('pre-restore-'));

    // Same running server, no restart: data is the restored copy and the license is still active.
    const list = await (await fetch(`${baseUrl}/api/students?limit=100`, { headers: authHeaders(token) })).json();
    assert.ok(!list.rows.some((s) => s.id === extra.id));
    assert.ok(list.rows.some((s) => s.id === studentId));
    const lic = await (await fetch(`${baseUrl}/api/license/status`)).json();
    assert.equal(lic.state, 'active');
  });
});
