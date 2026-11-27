import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Modal from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { printElement } from '../utils/print';
import { fmtDate } from '../utils/dateDisplay';
import { useSchoolInfo } from '../components/PaperView';
import { api, downloadFile } from '../api/client';
import DateInput from '../components/DateInput';

const REPORTS = [
  { id: 'student-strength', group: 'students', label: 'Student Strength (class-wise, boys / girls)', filters: ['class'] },
  { id: 'student-directory', group: 'students', label: 'Student Directory (contacts)', filters: ['class', 'section'] },
  { id: 'student-admissions', group: 'students', label: 'New Admissions', filters: ['class', 'dateRange'] },
  { id: 'students-left', group: 'students', label: 'Students Who Left', filters: ['class', 'dateRange'] },
  { id: 'class-wise', group: 'students', label: 'Class-wise Summary', filters: [] },
  { id: 'attendance-summary', group: 'attendance', label: 'Student Attendance Summary', filters: ['class', 'section', 'dateRange'],
    columns: [['sr', 'Sr'], ['full_name', 'Full Name'], ['student_code', 'Student ID'], ['roll_number', 'Roll No'], ['class_name', 'Class'], ['section_name', 'Section'],
      ['present_days', 'Present'], ['leave_days', 'Leave'], ['absent_days', 'Absent'], ['late_days', 'Late'], ['total_marked', 'Total Marked'], ['percent', 'Percent']] },
  { id: 'daily-absentees', group: 'attendance', label: 'Daily Absent / Late List', filters: ['class', 'date'] },
  { id: 'teacher-attendance-summary', group: 'attendance', label: 'Teacher Attendance Summary', filters: ['dateRange'] },
  { id: 'staff-attendance-summary', group: 'attendance', label: 'Non-Teaching Staff Attendance', filters: ['dateRange'] },
  { id: 'fee-collection', group: 'finance', label: 'Fee Collection', filters: ['class', 'dateRange'] },
  { id: 'fee-defaulters', group: 'finance', label: 'Fee Defaulters (overdue)', filters: ['class', 'section'] },
  { id: 'expense-by-category', group: 'finance', label: 'Expenses by Category', filters: ['dateRange'] },
  { id: 'payroll-summary', group: 'finance', label: 'Payroll Summary', filters: ['monthYear'] },
  { id: 'transport-fees', group: 'finance', label: 'Transport Routes & Fees', filters: [] },
  { id: 'inventory-stock', group: 'finance', label: 'Inventory Stock & Value', filters: [] },
  { id: 'result-summary', group: 'academic', label: 'Result Summary (pass %, toppers)', filters: [] },
  { id: 'subject-averages', group: 'academic', label: 'Subject Averages (tests & exams)', filters: ['section', 'dateRange'] },
  { id: 'syllabus-coverage', group: 'academic', label: 'Syllabus Coverage', filters: [] },
  { id: 'exam-summary', group: 'academic', label: 'Question Bank Summary', filters: [] },
  { id: 'teacher-performance', group: 'academic', label: 'Teacher Performance', filters: [] },
  { id: 'library-overdue', group: 'academic', label: 'Library — Overdue Books', filters: [] }
];
const GROUPS = [['students', 'Student Reports'], ['attendance', 'Attendance Reports'], ['finance', 'Financial Reports'], ['academic', 'Academic Reports']];

// Friendly column names for every report (raw field names otherwise).
const LABELS = {
  sr: 'Sr', full_name: 'Full Name', student_code: 'Student ID', teacher_code: 'Teacher ID', staff_code: 'Staff ID', roll_number: 'Roll No',
  class_name: 'Class', section_name: 'Section', admission_number: 'Admission No', total_marked: 'Total Marked', percent: 'Percent'
};
const labelFor = (k) => LABELS[k] || k.replace(/_days$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Internal / helper fields never shown.
const HIDDEN = new Set(['id', 'class_section', 'student_id', 'teacher_id', 'staff_id', 'section_id', 'class_id', 'parent_id']);
const isNumberish = (v) => v === null || v === undefined || v === '' || v === '-' || /^-?\d+(\.\d+)?%?$/.test(String(v));

function buildColumns(report, data) {
  if (!data.length) return [];
  const cols = report.columns
    ? report.columns.filter(([k]) => k in data[0]).map(([key, label]) => ({ key, label }))
    : Object.keys(data[0]).filter((k) => !HIDDEN.has(k)).map((key) => ({ key, label: labelFor(key) }));
  // Number columns (counts, amounts, %) are centred.
  return cols.map((c) => ({ ...c, center: data.slice(0, 200).every((r) => isNumberish(r[c.key])) && data.some((r) => r[c.key] !== null && r[c.key] !== '' && r[c.key] !== undefined) }));
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const group = params.get('group') || 'students';
  const list = REPORTS.filter((r) => r.group === group);
  const [reportId, setReportId] = useState(list[0].id);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState([]);
  const [sending, setSending] = useState(null);
  const printRef = useRef(null);
  const school = useSchoolInfo();
  const toast = useToast();
  useEffect(() => { api.get('/academics/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { if (!list.some((r) => r.id === reportId)) setReportId(list[0].id); }, [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/academics/sections').then(setSections).catch(() => {}); }, []);

  const report = REPORTS.find((r) => r.id === reportId) || list[0];

  function buildQuery(extra = '') {
    const params = new URLSearchParams();
    if (report.filters.includes('section') && sectionId) params.set('section_id', sectionId);
    if (report.filters.includes('class') && classId) params.set('class_id', classId);
    if (report.filters.includes('dateRange')) { if (from) params.set('from', from); if (to) params.set('to', to); }
    if (report.filters.includes('monthYear')) { if (month) params.set('month', month); if (year) params.set('year', year); }
    if (report.filters.includes('date') && date) params.set('date', date);
    if (extra) params.set('format', extra);
    return params.toString();
  }

  async function runReport() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/reports/${report.id}?${buildQuery()}`);
      setRows(data);
      setColumns(buildColumns(report, data));
    } catch (err) {
      setRows([]); setColumns([]); setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runReport(); }, [reportId]);

  return (
    <div>
      <div className="page-header"><h2>Reports</h2></div>
      <div className="row" style={{ marginBottom: 12 }}>
        {GROUPS.map(([k, l]) => <button key={k} type="button" className={group === k ? '' : 'btn-ghost'} onClick={() => setParams({ group: k }, { replace: true })}>{l}</button>)}
      </div>
      <div className="card">
        <div className="row">
          <select value={report.id} onChange={(e) => setReportId(e.target.value)} style={{ maxWidth: 340 }}>
            {list.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          {report.filters.includes('date') && <DateInput value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />}
          {report.filters.includes('class') && (
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ maxWidth: 180 }}>
              <option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {report.filters.includes('section') && (
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">All sections</option>{sections.filter((s) => !classId || String(s.class_id) === String(classId)).map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
            </select>
          )}
          {report.filters.includes('dateRange') && (
            <>
              <DateInput value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 160 }} />
              <DateInput value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 160 }} />
            </>
          )}
          {report.filters.includes('monthYear') && (
            <>
              <input type="number" placeholder="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 100 }} />
              <input type="number" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} style={{ maxWidth: 120 }} />
            </>
          )}
          <button type="button" onClick={runReport}>Search</button>
          <div className="spacer" />
          <button type="button" className="btn-secondary" disabled={!rows.length} onClick={() => printElement(printRef.current, report.label)}>🖨 Print</button>
          <button type="button" className="btn-secondary" disabled={!rows.length} onClick={() => setSending({ phone: '', email: '', message: '' })}>📤 Send</button>
          <button type="button" className="btn-secondary" onClick={() => downloadFile(`/reports/${report.id}?${buildQuery('pdf')}`, `${report.id}.pdf`)}>Export PDF</button>
          <button type="button" className="btn-secondary" onClick={() => downloadFile(`/reports/${report.id}?${buildQuery('excel')}`, `${report.id}.xlsx`)}>Export Excel</button>
        </div>
      </div>

      <div className="card">
        {loading ? <p className="muted">Loading…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr>{columns.map((c) => <th key={c.key} style={c.center ? { textAlign: 'center' } : undefined}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>{columns.map((c) => <td key={c.key} style={c.center ? { textAlign: 'center' } : undefined}>{String(row[c.key] ?? '')}</td>)}</tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={columns.length || 1} className="muted">{error || 'No data for this report yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <style>{`.rp{font-family:Segoe UI,Arial,sans-serif;color:#111} .rp h1{font-size:20px;color:#1d4ed8;margin:0;text-align:center} .rp h2{font-size:15px;margin:4px 0 2px;text-align:center} .rp .meta{text-align:center;color:#555;font-size:11px;margin-bottom:10px} .rp table{width:100%;border-collapse:collapse;font-size:11px} .rp th,.rp td{border:1px solid #c7ccd6;padding:4px 6px;text-align:left} .rp th{background:#eef2f9;text-transform:capitalize} .rp .head{display:flex;align-items:center;gap:10px;border-bottom:2px solid #1d4ed8;padding-bottom:6px;margin-bottom:6px} .rp .head img{width:48px;height:48px;object-fit:contain}`}</style>
          <div className="rp">
            <div className="head">{school.logo && <img src={school.logo} alt="" />}<div style={{ flex: 1 }}><h1>{school.name}</h1><h2>{report.label}</h2></div></div>
            <div className="meta">
              {[classId && `Class: ${classes.find((c) => String(c.id) === String(classId))?.name || ''}`, sectionId && `Section: ${(() => { const x = sections.find((y) => String(y.id) === String(sectionId)); return x ? `${x.class_name} - ${x.name}` : ''; })()}`,
                report.filters.includes('dateRange') && (from || to) && `Period: ${from || '…'} to ${to || '…'}`, report.filters.includes('date') && `Date: ${date}`,
                `Printed ${fmtDate(new Date())} ${new Date().toTimeString().slice(0, 5)}`, `${rows.length} row(s)`].filter(Boolean).join('  ·  ')}
            </div>
            <table>
              <thead><tr>{columns.map((c) => <th key={c.key} style={c.center ? { textAlign: 'center' } : undefined}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.map((row, i) => <tr key={i}>{columns.map((c) => <td key={c.key} style={c.center ? { textAlign: 'center' } : undefined}>{String(row[c.key] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>

      {sending && (
        <Modal title={`Send — ${report.label}`} onClose={() => setSending(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try {
              const q = new URLSearchParams(buildQuery('send'));
              if (sending.phone) q.set('phone', sending.phone);
              if (sending.email) q.set('email', sending.email);
              if (sending.message) q.set('message', sending.message);
              const r = await api.get(`/reports/${report.id}?${q}`);
              if (r.summary.sent) toast.success('Report sent as a PDF');
              else if (r.summary.simulated) toast.info('WhatsApp / email is not set up in Settings, so nothing was sent. Use Export PDF and share it yourself.');
              else toast.error('Could not deliver — check the number / email');
              setSending(null);
            } catch (err) { toast.error(err.message); }
          }}>
            <p className="muted" style={{ marginTop: 0 }}>Sends this report (with the current filters) as a PDF.</p>
            <div className="field"><label>WhatsApp number</label><input type="tel" placeholder="e.g. 0300 1234567" value={sending.phone} onChange={(e) => setSending({ ...sending, phone: e.target.value })} /></div>
            <div className="field"><label>Email</label><input type="email" value={sending.email} onChange={(e) => setSending({ ...sending, email: e.target.value })} /></div>
            <div className="field"><label>Message (optional)</label><input value={sending.message} onChange={(e) => setSending({ ...sending, message: e.target.value })} /></div>
            <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setSending(null)}>Cancel</button><button type="submit" disabled={!sending.phone && !sending.email}>Send PDF</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
