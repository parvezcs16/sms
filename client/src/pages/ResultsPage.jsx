import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import CrudManager from '../components/CrudManager';
import PrintSheet from '../components/PrintSheet';
import { printElement } from '../utils/print';
import IconButton from '../components/IconButton';
import ShareButtons from '../components/ShareButtons';
import { localDateStr } from '../utils/date';
import { openWhatsApp } from '../utils/whatsapp';
import { textProps } from '../utils/urdu';
import { fmtDateTime } from '../utils/payment';
import DateInput from '../components/DateInput';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const sectionLabel = (s) => (s ? `${s.class_name} - ${s.section_name}` : '');

// Report periods: a day, a month, a quarter, a year, or any range.
function periodRange(p) {
  if (p.type === 'daily') return { from: p.date, to: p.date, label: p.date };
  if (p.type === 'monthly') {
    const [y, m] = p.month.split('-').map(Number);
    return { from: `${p.month}-01`, to: `${p.month}-${pad(new Date(y, m, 0).getDate())}`, label: `${MONTHS[m - 1]} ${y}` };
  }
  if (p.type === 'quarterly') {
    const q = Number(p.quarter);
    const sm = (q - 1) * 3 + 1;
    const em = sm + 2;
    return { from: `${p.year}-${pad(sm)}-01`, to: `${p.year}-${pad(em)}-${pad(new Date(p.year, em, 0).getDate())}`, label: `Q${q} ${p.year} (${MONTHS[sm - 1]}–${MONTHS[em - 1]})` };
  }
  if (p.type === 'yearly') return { from: `${p.year}-01-01`, to: `${p.year}-12-31`, label: `Year ${p.year}` };
  return { from: p.from, to: p.to, label: p.from && p.to ? `${p.from} to ${p.to}` : 'Custom' };
}

function defaultPeriod() {
  const d = new Date();
  return { type: 'monthly', date: localDateStr(), month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, quarter: Math.floor(d.getMonth() / 3) + 1, year: d.getFullYear(), from: '', to: localDateStr() };
}

function PeriodPicker({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div className="row filters" style={{ margin: 0, flexWrap: 'wrap' }}>
      <div className="seg">
        {[['daily', 'Daily'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly'], ['custom', 'Custom']].map(([k, l]) => (
          <button key={k} type="button" className={value.type === k ? 'active' : ''} onClick={() => set('type', k)}>{l}</button>
        ))}
      </div>
      {value.type === 'daily' && <DateInput value={value.date} onChange={(e) => set('date', e.target.value)} style={{ maxWidth: 160 }} />}
      {value.type === 'monthly' && <input type="month" value={value.month} onChange={(e) => set('month', e.target.value)} style={{ maxWidth: 170 }} />}
      {value.type === 'quarterly' && (
        <>
          <select value={value.quarter} onChange={(e) => set('quarter', Number(e.target.value))} style={{ maxWidth: 160 }}>
            <option value={1}>Q1 (Jan–Mar)</option><option value={2}>Q2 (Apr–Jun)</option><option value={3}>Q3 (Jul–Sep)</option><option value={4}>Q4 (Oct–Dec)</option>
          </select>
          <select value={value.year} onChange={(e) => set('year', Number(e.target.value))} style={{ maxWidth: 100 }}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </>
      )}
      {value.type === 'yearly' && <select value={value.year} onChange={(e) => set('year', Number(e.target.value))} style={{ maxWidth: 100 }}>{years.map((y) => <option key={y}>{y}</option>)}</select>}
      {value.type === 'custom' && (
        <>
          <DateInput value={value.from} onChange={(e) => set('from', e.target.value)} style={{ maxWidth: 160 }} />
          <span className="muted">to</span>
          <DateInput value={value.to} onChange={(e) => set('to', e.target.value)} style={{ maxWidth: 160 }} />
        </>
      )}
    </div>
  );
}

function qs(obj) {
  return Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export default function ResultsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const tab = params.get('tab') || 'marks';
  const [countryCode, setCountryCode] = useState('');

  async function loadMeta() {
    try {
      setMeta(await api.get('/results/meta'));
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    loadMeta();
    api.get('/settings').then((s) => setCountryCode(s.default_country_code || '')).catch(() => {});
  }, []);

  function switchTab(t) {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  }

  if (error) return <div className="card"><p>{error}</p></div>;
  if (!meta) return <div className="card muted">Loading…</div>;
  if (!meta.sections.length) {
    return (
      <div>
        <div className="page-header"><h2>Marks &amp; Results</h2></div>
        <div className="card muted">You are not assigned to any class yet. Ask the office to set you as a class or subject teacher in Classes &amp; Subjects.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header"><h2>Marks &amp; Results</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'exams' ? '' : 'btn-ghost'} onClick={() => switchTab('exams')}>Examinations</button>
        <button type="button" className={tab === 'marks' ? '' : 'btn-ghost'} onClick={() => switchTab('marks')}>Marks Entry</button>
        <button type="button" className={tab === 'progress' ? '' : 'btn-ghost'} onClick={() => switchTab('progress')}>Progress Reports</button>
        <button type="button" className={tab === 'cards' ? '' : 'btn-ghost'} onClick={() => switchTab('cards')}>Result Cards</button>
      </div>
      {tab === 'exams' && (
        <CrudManager
          endpoint="/results/terms"
          noun="exam"
          addLabel="New Exam"
          canManage={meta.can_manage}
          onLoaded={loadMeta}
          fields={[
            { key: 'name', label: 'Name', required: true, full: true, placeholder: 'e.g. Annual Examination 2026' },
            { key: 'kind', label: 'Type', type: 'select', options: meta.term_kinds, noBlank: true, default: 'Annual' },
            { key: 'session', label: 'Session', default: meta.session },
            { key: 'start_date', label: 'Starts', type: 'date' },
            { key: 'end_date', label: 'Result date', type: 'date' }
          ]}
          columns={[
            { key: 'name', label: 'Exam', render: (r) => <b dir="auto">{r.name}</b> },
            { key: 'kind', label: 'Type' },
            { key: 'session', label: 'Session' },
            { key: 'dates', label: 'Dates', render: (r) => [r.start_date, r.end_date].filter(Boolean).join(' → ') || '—' },
            { key: 'scheduled', label: 'Date sheet', render: (r) => <Link to="/date-sheet" onClick={(e) => e.stopPropagation()}>{r.scheduled} paper(s)</Link> },
            { key: 'papers', label: 'Marks', render: (r) => `${r.papers} paper(s) in ${r.classes} class(es)` },
            { key: 'approved_classes', label: 'Results approved', render: (r) => `${r.approved_classes} / ${r.classes}` }
          ]}
          rowActions={(r) => <button type="button" className="btn-ghost btn-sm" onClick={() => switchTab('cards')}>Result cards</button>}
          emptyMessage="No exams yet. Create one (e.g. “First Term 2026”), schedule it in Date Sheet, enter marks, then print result cards."
          describe={(r) => r.name}
        />
      )}
      {tab === 'marks' && <MarksTab meta={meta} toast={toast} />}
      {tab === 'progress' && <ProgressTab meta={meta} toast={toast} countryCode={countryCode} initialStudent={params.get('student')} />}
      {tab === 'cards' && <CardsTab meta={meta} toast={toast} reloadMeta={loadMeta} countryCode={countryCode} />}
    </div>
  );
}

// ============================ Tests & marks ============================
function canEditFor(meta, sectionId, subjectId) {
  if (meta.can_manage) return true;
  const e = meta.editable?.[sectionId];
  return e === 'all' || (Array.isArray(e) && e.includes(Number(subjectId)));
}

function MarksTab({ meta, toast }) {
  const [filter, setFilter] = useState({ section_id: '', subject_id: '', kind: '', term_id: '' });
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [marking, setMarking] = useState(null);

  async function load() {
    try {
      setList(await api.get(`/results/assessments?${qs(filter)}`));
    } catch (err) {
      toast.error(err.message);
    }
  }
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const editableSections = meta.sections.filter((s) => meta.can_manage || meta.editable?.[s.id] === 'all' || (meta.editable?.[s.id] || []).length);
  const subjectsFor = (sectionId) => meta.subjects.filter((s) => !sectionId || canEditFor(meta, Number(sectionId), s.id));

  function newTest() {
    const sec = filter.section_id || (editableSections[0] && String(editableSections[0].id)) || '';
    setForm({ id: null, kind: filter.kind || 'Daily Test', title: '', section_id: sec, subject_id: filter.subject_id || '', term_id: filter.term_id || '', held_on: localDateStr(), total_marks: 20, pass_marks: '' });
  }

  async function saveTest(e) {
    e.preventDefault();
    const body = { ...form, term_id: form.term_id || null, pass_marks: form.pass_marks === '' ? null : Number(form.pass_marks), total_marks: Number(form.total_marks) };
    try {
      if (form.id) {
        await api.put(`/results/assessments/${form.id}`, body);
        toast.success('Test updated');
        setForm(null);
        load();
      } else {
        const res = await api.post('/results/assessments', body);
        toast.success('Test added — now enter the marks');
        setForm(null);
        await load();
        setMarking(res.id);
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeTest(a) {
    if (!window.confirm(`Remove "${a.title}" (${a.subject_name}, ${a.held_on}) and its marks from reports?`)) return;
    try {
      await api.del(`/results/assessments/${a.id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const isExam = (k) => /Exam/.test(k);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 10px' }}>
        <div className="row filters" style={{ margin: 0 }}>
          <select value={filter.section_id} onChange={(e) => setFilter({ ...filter, section_id: e.target.value })}>
            <option value="">All my classes</option>{meta.sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
          </select>
          <select value={filter.subject_id} onChange={(e) => setFilter({ ...filter, subject_id: e.target.value })}>
            <option value="">All subjects</option>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
            <option value="">All test types</option>{meta.kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
          {meta.terms.length > 0 && (
            <select value={filter.term_id} onChange={(e) => setFilter({ ...filter, term_id: e.target.value })}>
              <option value="">Any exam</option>{meta.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
        {editableSections.length > 0 && <button type="button" onClick={newTest}>+ New Test / Exam</button>}
      </div>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Test</th><th>Class</th><th>Subject</th><th>Marks</th><th>Entered</th><th>Class avg</th><th /></tr></thead>
        <tbody>
          {list.map((a) => {
            const editable = canEditFor(meta, a.section_id, a.subject_id);
            return (
              <tr key={a.id} className="row-selectable" onClick={() => setMarking(a.id)}>
                <td>{a.held_on}</td><td>{a.kind}</td>
                <td {...textProps(a.title)}>{a.title}{a.term_name && <div className="muted" style={{ fontSize: '0.72rem' }}>{a.term_name}</div>}</td>
                <td>{a.class_name} - {a.section_name}</td><td>{a.subject_name}</td><td>{a.total_marks}</td>
                <td>{a.entered}</td><td>{pct(a.average)}</td>
                <td onClick={(e) => e.stopPropagation()}><div className="actions-cell">
                  <IconButton icon={editable ? 'edit' : 'view'} tone="primary" label={editable ? 'Enter / correct marks' : 'View marks'} onClick={() => setMarking(a.id)} />
                  {editable && <IconButton icon="history" tone="default" label="Edit test details" onClick={() => setForm({ ...a, term_id: a.term_id ? String(a.term_id) : '', section_id: String(a.section_id), subject_id: String(a.subject_id), pass_marks: a.pass_marks ?? '' })} />}
                  {editable && <IconButton icon="trash" tone="danger" label="Remove test" onClick={() => removeTest(a)} />}
                </div></td>
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={9} className="muted">No tests yet. Click “+ New Test / Exam”, then type the marks.</td></tr>}
        </tbody>
      </table>

      {form && (
        <Modal title={form.id ? 'Edit Test' : 'New Test / Exam'} onClose={() => setForm(null)}>
          <form onSubmit={saveTest}>
            <div className="form-grid">
              <div className="field"><label>Type</label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{meta.kinds.map((k) => <option key={k}>{k}</option>)}</select>
              </div>
              <div className="field"><label>Date</label><DateInput required value={form.held_on} onChange={(e) => setForm({ ...form, held_on: e.target.value })} /></div>
              <div className="field"><label>Class</label>
                <select required value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value, subject_id: '' })}>
                  <option value="">Select</option>{editableSections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
                </select>
              </div>
              <div className="field"><label>Subject</label>
                <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                  <option value="">Select</option>{subjectsFor(form.section_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Total Marks</label><input type="number" min="1" step="0.5" required value={form.total_marks} onChange={(e) => setForm({ ...form, total_marks: e.target.value })} /></div>
              <div className="field"><label>Pass Marks <span className="muted">(optional)</span></label><input type="number" min="0" step="0.5" value={form.pass_marks} placeholder={`${meta.grading.pass_percentage}% if blank`} onChange={(e) => setForm({ ...form, pass_marks: e.target.value })} /></div>
            </div>
            <div className="field"><label>Title <span className="muted">(optional)</span></label><input dir="auto" value={form.title} placeholder={`e.g. ${form.kind} — Chapter 3`} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field"><label>Counts towards result card of {isExam(form.kind) ? '' : <span className="muted">(usually only for exams)</span>}</label>
              <select value={form.term_id} onChange={(e) => setForm({ ...form, term_id: e.target.value })}>
                <option value="">— none (progress reports only) —</option>{meta.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {meta.terms.length === 0 && <span className="muted" style={{ fontSize: '0.75rem' }}>Exams (e.g. “Annual Examination 2026”) are set up in Result Cards.</span>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit">{form.id ? 'Save' : 'Add & Enter Marks'}</button>
            </div>
          </form>
        </Modal>
      )}
      {marking && <MarksModal id={marking} toast={toast} onClose={() => setMarking(null)} onSaved={load} />}
    </div>
  );
}

function MarksModal({ id, toast, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const inputs = useRef([]);

  useEffect(() => {
    api.get(`/results/assessments/${id}/marks`).then((d) => {
      setData(d);
      setRows(d.rows.map((r) => ({ ...r, obtained: r.obtained ?? '' })));
    }).catch((err) => { toast.error(err.message); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Modal title="Marks" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const a = data.assessment;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const entered = rows.filter((r) => r.absent || r.obtained !== '').length;
  const bad = rows.filter((r) => !r.absent && r.obtained !== '' && !(Number(r.obtained) >= 0 && Number(r.obtained) <= a.total_marks));

  async function save() {
    if (bad.length) return toast.error(`Marks must be between 0 and ${a.total_marks} — check ${bad.map((r) => r.full_name).join(', ')}`);
    setSaving(true);
    try {
      const res = await api.put(`/results/assessments/${id}/marks`, {
        marks: rows.map((r) => ({ student_id: r.student_id, obtained: r.absent || r.obtained === '' ? null : Number(r.obtained), absent: r.absent, remarks: r.remarks }))
      });
      toast.success(`Marks saved for ${res.saved} students`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${a.title} — ${a.class_name} ${a.section_name} · ${a.subject_name}`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>{a.kind} on {a.held_on} · out of <b>{a.total_marks}</b>{a.pass_marks !== null && a.pass_marks !== undefined ? ` · pass ${a.pass_marks}` : ''} · {entered}/{rows.length} entered{data.can_edit ? ' · press Enter to go to the next student' : ''}</p>
      <table>
        <thead><tr><th>Roll</th><th>Student</th><th style={{ width: 110 }}>Marks</th><th>Absent</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const invalid = !r.absent && r.obtained !== '' && !(Number(r.obtained) >= 0 && Number(r.obtained) <= a.total_marks);
            return (
              <tr key={r.student_id}>
                <td>{r.roll_number ?? '—'}</td><td>{r.full_name}</td>
                <td>
                  <input ref={(el) => { inputs.current[i] = el; }} type="number" step="0.5" min="0" max={a.total_marks} disabled={!data.can_edit || r.absent}
                    value={r.absent ? '' : r.obtained} style={invalid ? { borderColor: 'var(--danger)' } : undefined}
                    onChange={(e) => setRow(i, { obtained: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); inputs.current[i + 1]?.focus(); } }} />
                </td>
                <td><input type="checkbox" style={{ width: 'auto' }} disabled={!data.can_edit} checked={r.absent} onChange={(e) => setRow(i, { absent: e.target.checked })} /></td>
                <td><input dir="auto" disabled={!data.can_edit} value={r.remarks} onChange={(e) => setRow(i, { remarks: e.target.value })} /></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No students in this class.</td></tr>}
        </tbody>
      </table>
      <div className="modal-footer">
        <button type="button" className="btn-ghost" onClick={onClose}>{data.can_edit ? 'Cancel' : 'Close'}</button>
        {data.can_edit && <button type="button" disabled={saving || !rows.length} onClick={save}>{saving ? 'Saving…' : 'Save Marks'}</button>}
      </div>
    </Modal>
  );
}

// ============================ Progress reports ============================
function ProgressTab({ meta, toast, countryCode, initialStudent }) {
  const [sectionId, setSectionId] = useState('');
  const [period, setPeriod] = useState(defaultPeriod);
  const [kind, setKind] = useState('');
  const [summary, setSummary] = useState(null);
  const [studentId, setStudentId] = useState(initialStudent || '');
  const [report, setReport] = useState(null);
  const [sending, setSending] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const classSheetRef = useRef(null);
  const range = useMemo(() => periodRange(period), [period]);
  const query = qs({ from: range.from, to: range.to, kind, label: range.label });

  useEffect(() => {
    if (!sectionId) { setSummary(null); return; }
    api.get(`/results/sections/${sectionId}/summary?${query}`).then(setSummary).catch((err) => toast.error(err.message));
  }, [sectionId, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!studentId) { setReport(null); return; }
    api.get(`/results/students/${studentId}/progress?${query}`).then((r) => {
      setReport(r);
      if (!sectionId && r.student) {
        const sec = meta.sections.find((s) => sectionLabel(s) === r.student.class_label);
        if (sec) setSectionId(String(sec.id));
      }
    }).catch((err) => { toast.error(err.message); setReport(null); });
  }, [studentId, query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendWhatsApp() {
    setSending(true);
    try {
      const res = await api.post(`/results/students/${studentId}/progress/send`, { from: range.from, to: range.to, kind, label: range.label });
      if (res.summary.sent) toast.success('Report PDF sent to the parent on WhatsApp');
      else if (res.summary.simulated) toast.info('School WhatsApp is not linked (Settings → WhatsApp), so the PDF was not sent. Use “Open WhatsApp chat” instead.');
      else toast.error('WhatsApp could not deliver the report — check the parent phone number');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  function chatText(r) {
    const o = r.overall;
    const lines = [
      `Assalam-o-Alaikum ${r.student.parent_name || ''}`.trim() + ',',
      `Progress report of ${r.student.full_name} (${r.student.class_label || ''}) — ${range.label}:`,
      ...r.subjects.map((s) => `• ${s.subject_name}: ${pct(s.percentage)} (${s.grade})`),
      `Overall: ${pct(o.percentage)}, Grade ${o.grade}${o.absent ? `, absent in ${o.absent} test(s)` : ''}.`
    ];
    return lines.join('\n');
  }

  return (
    <div>
      <div className="card">
        <div className="row filters" style={{ margin: 0, flexWrap: 'wrap' }}>
          <select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setStudentId(''); }}>
            <option value="">Select class</option>{meta.sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
          </select>
          <PeriodPicker value={period} onChange={setPeriod} />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All tests &amp; exams</option>{meta.kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>Period: <b>{range.label}</b>. Pick a class to see everyone, then click a student for their full report.</p>
      </div>

      {summary && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 8px' }}>
            <h3 style={{ margin: 0 }}>Class report — {range.label} <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>({summary.tests} tests)</span></h3>
            <div className="actions-cell">
              <button type="button" className="btn-secondary btn-sm" disabled={!summary.students.length} onClick={() => printElement(classSheetRef.current, 'Class report')}>🖨 Print class report</button>
              <button type="button" className="btn-secondary btn-sm" disabled={bulkSending || !summary.students.length} onClick={async () => {
                if (!window.confirm(`Send each student's ${range.label} progress report (PDF) to their parent on WhatsApp / email?`)) return;
                setBulkSending(true);
                try {
                  const r = await api.post(`/results/sections/${sectionId}/progress/send-all`, { from: range.from, to: range.to, kind, label: range.label });
                  toast.success(`Sent ${r.sent} of ${r.students}${r.simulated ? ` · ${r.simulated} not sent (WhatsApp / email not set up in Settings)` : ''}${r.no_contact ? ` · ${r.no_contact} without a phone / email` : ''}${r.failed ? ` · ${r.failed} failed` : ''}`);
                } catch (err) { toast.error(err.message); } finally { setBulkSending(false); }
              }}>{bulkSending ? 'Sending…' : '📤 Send to all parents'}</button>
            </div>
          </div>
          <PrintSheet ref={classSheetRef} title={`Class Progress Report — ${range.label}`}
            meta={[meta.sections.find((x) => String(x.id) === String(sectionId)) && sectionLabel(meta.sections.find((x) => String(x.id) === String(sectionId))), kind || 'All tests & exams', `${summary.tests} tests`].filter(Boolean).join('  ·  ')}
            columns={[{ key: 'roll', label: 'Roll' }, { key: 'name', label: 'Student' }, ...summary.subjects.map((x) => ({ key: `s${x.subject_id}`, label: x.subject_name })), { key: 'overall', label: 'Overall' }, { key: 'grade', label: 'Grade' }]}
            rows={summary.students.map((st) => ({ roll: st.roll_number ?? '', name: st.full_name, ...Object.fromEntries(summary.subjects.map((x) => [`s${x.subject_id}`, pct(st.subjects[x.subject_id])])), overall: pct(st.percentage), grade: st.grade }))}
            signatures={['Class Teacher', 'Principal']} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Roll</th><th>Student</th>{summary.subjects.map((s) => <th key={s.subject_id}>{s.subject_name}</th>)}<th>Overall</th><th>Grade</th></tr></thead>
              <tbody>
                {summary.students.map((s) => (
                  <tr key={s.student_id} className={`row-selectable${String(s.student_id) === String(studentId) ? ' row-selected' : ''}`} onClick={() => setStudentId(String(s.student_id))}>
                    <td>{s.roll_number ?? '—'}</td><td>{s.full_name}</td>
                    {summary.subjects.map((sub) => <td key={sub.subject_id}>{pct(s.subjects[sub.subject_id])}</td>)}
                    <td><b>{pct(s.percentage)}</b></td><td>{s.grade}</td>
                  </tr>
                ))}
                {summary.students.length === 0 && <tr><td colSpan={summary.subjects.length + 4} className="muted">No students.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <div>
              <h3 style={{ margin: 0 }}>{report.student.full_name} <span className="muted" style={{ fontWeight: 400 }}>· {report.student.class_label} · Roll {report.student.roll_number ?? '—'}</span></h3>
              <span className="muted" style={{ fontSize: '0.85rem' }}>{range.label}{kind ? ` · ${kind}` : ''} · Parent: {report.student.parent_name || '—'} {report.student.parent_phone ? `(${report.student.parent_phone})` : ''}</span>
            </div>
            <div className="actions-cell">
              <ShareButtons iconOnly path={`/results/students/${report.student.id}/progress.pdf?${query}`} filenameBase={`progress-${report.student.student_code}`} />
              <button type="button" className="btn-success btn-sm" disabled={!report.student.parent_phone} onClick={() => openWhatsApp(report.student.parent_phone, chatText(report), countryCode)} title="Opens WhatsApp with the summary typed in">Open WhatsApp chat</button>
              <button type="button" className="btn-ghost btn-sm" disabled={sending || !report.student.parent_phone} onClick={sendWhatsApp} title="Sends the PDF from the school's linked WhatsApp number">{sending ? 'Sending…' : 'Send PDF on WhatsApp'}</button>
            </div>
          </div>
          {!report.student.parent_phone && <p className="muted" style={{ fontSize: '0.8rem' }}>No parent phone number on file — add one on the student's record to share on WhatsApp.</p>}

          <div className="grid" style={{ marginTop: 12 }}>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Average</span><div className="stat-value">{pct(report.overall.percentage)}</div><span className="stat-sub">Grade {report.overall.grade}</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Tests / Exams</span><div className="stat-value">{report.overall.tests}</div><span className="stat-sub">{report.overall.absent} absent</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Marks</span><div className="stat-value">{report.overall.obtained}</div><span className="stat-sub">out of {report.overall.total}</span></div>
          </div>

          {report.items.length === 0 ? <p className="muted">No marks entered for this period.</p> : (
            <>
              <h4 style={{ marginTop: 16 }}>By subject</h4>
              <table>
                <thead><tr><th>Subject</th><th>Tests</th><th>Marks</th><th>Average</th><th>Grade</th><th>Best</th><th>Lowest</th></tr></thead>
                <tbody>
                  {report.subjects.map((s) => (
                    <tr key={s.subject_id}><td>{s.subject_name}</td><td>{s.tests}{s.absent ? ` (${s.absent} absent)` : ''}</td><td>{s.obtained} / {s.total}</td><td><Bar value={s.percentage} /></td><td>{s.grade}</td><td>{pct(s.best)}</td><td>{pct(s.worst)}</td></tr>
                  ))}
                </tbody>
              </table>
              {report.trend.length > 1 && (
                <>
                  <h4>Month by month</h4>
                  {report.trend.map((m) => <div key={m.month} className="row" style={{ margin: '2px 0' }}><span style={{ width: 70 }}>{m.month}</span><Bar value={m.percentage} wide /></div>)}
                </>
              )}
              <h4>All tests</h4>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Test</th><th>Subject</th><th>Marks</th><th>%</th><th>Grade</th><th>Remarks</th></tr></thead>
                <tbody>
                  {report.items.map((r) => (
                    <tr key={r.id}><td>{r.held_on}</td><td>{r.kind}</td><td {...textProps(r.title)}>{r.title}</td><td>{r.subject_name}</td>
                      <td>{r.absent ? <span className="muted">Absent</span> : `${r.obtained} / ${r.total_marks}`}</td><td>{pct(r.percentage)}</td><td>{r.absent ? '—' : r.grade}</td><td dir="auto">{r.remarks || ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ value, wide }) {
  const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="row" style={{ margin: 0, gap: 6, flexWrap: 'nowrap' }}>
      <span className="fin-bar" style={{ width: wide ? 260 : 90 }}><span style={{ width: `${v}%` }} /></span>
      <b style={{ fontSize: '0.85rem' }}>{pct(value)}</b>
    </span>
  );
}

// ============================ Result cards ============================
function CardsTab({ meta, toast, reloadMeta, countryCode }) {
  const sheetRef = useRef(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [termId, setTermId] = useState(meta.terms[0] ? String(meta.terms[0].id) : '');
  const [sectionId, setSectionId] = useState(meta.sections[0] ? String(meta.sections[0].id) : '');
  const [sheet, setSheet] = useState(null);
  const [remarks, setRemarks] = useState({});
  const [dirty, setDirty] = useState(false);
  const [termForm, setTermForm] = useState(null);
  const [grading, setGrading] = useState(null);

  async function load() {
    if (!termId || !sectionId) { setSheet(null); return; }
    try {
      const d = await api.get(`/results/terms/${termId}/sections/${sectionId}`);
      setSheet(d);
      setRemarks(Object.fromEntries(d.students.map((s) => [s.student_id, { teacher_remarks: s.teacher_remarks, principal_remarks: s.principal_remarks }])));
      setDirty(false);
    } catch (err) {
      toast.error(err.message);
      setSheet(null);
    }
  }
  useEffect(() => { load(); }, [termId, sectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTerm(e) {
    e.preventDefault();
    try {
      if (termForm.id) await api.put(`/results/terms/${termForm.id}`, termForm);
      else {
        const r = await api.post('/results/terms', termForm);
        setTermId(String(r.id));
      }
      toast.success('Exam saved. Tests linked to it count towards its result cards.');
      setTermForm(null);
      reloadMeta();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveRemarks() {
    try {
      await api.put(`/results/terms/${termId}/sections/${sectionId}/remarks`, {
        remarks: Object.entries(remarks).map(([sid, r]) => ({ student_id: Number(sid), ...r }))
      });
      toast.success('Remarks saved');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function approve(undo = false) {
    try {
      if (undo) {
        if (!window.confirm('Remove the approval? Parents will no longer see this result in their portal.')) return;
        await api.del(`/results/terms/${termId}/sections/${sectionId}/approve`);
      } else {
        const incomplete = sheet.stats.incomplete;
        const msg = incomplete
          ? `${incomplete} student(s) still have marks missing. Approve the results anyway?`
          : `Approve the ${sheet.term.name} results of ${sectionLabel(sheet.section)}? Your name, designation and the time will be printed on every result card.`;
        if (!window.confirm(msg)) return;
        if (dirty) await saveRemarks();
        await api.post(`/results/terms/${termId}/sections/${sectionId}/approve`, { force: incomplete > 0 });
        toast.success('Results approved');
      }
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function sendCard(s) {
    try {
      const res = await api.post(`/results/terms/${termId}/sections/${sectionId}/cards/${s.student_id}/send`, {});
      if (res.summary.sent) toast.success(`Result card sent to ${s.full_name}'s parent on WhatsApp`);
      else if (res.summary.simulated) toast.info('School WhatsApp is not linked (Settings → WhatsApp). Download the card and share it, or use the chat button.');
      else toast.error('WhatsApp could not deliver the card — check the parent phone number');
    } catch (err) {
      toast.error(err.message);
    }
  }

  function chat(s) {
    api.get(`/students/${s.student_id}`).then((st) => {
      const parent = st.parent_phone;
      if (!parent) return toast.error('No parent phone number on file');
      const lines = [
        `Assalam-o-Alaikum, ${sheet.term.name} result of ${s.full_name} (${sectionLabel(sheet.section)}):`,
        ...sheet.subjects.map((sub) => { const r = s.subjects[sub.subject_id] || {}; return `• ${sub.subject_name}: ${r.absent ? 'Absent' : `${r.obtained ?? '—'}/${sub.total}`} (${r.grade || '—'})`; }),
        `Total: ${s.obtained}/${s.total} = ${pct(s.percentage)}, Grade ${s.grade}, ${s.status}${s.position ? `, Position ${s.position}` : ''}.`
      ];
      openWhatsApp(parent, lines.join('\n'), countryCode);
    }).catch((err) => toast.error(err.message));
  }

  const setRemark = (sid, k, v) => { setRemarks((r) => ({ ...r, [sid]: { ...r[sid], [k]: v } })); setDirty(true); };

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
          <div className="row filters" style={{ margin: 0 }}>
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Select exam</option>{meta.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {meta.sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
            </select>
          </div>
          <div className="row" style={{ margin: 0 }}>
            {meta.can_manage && <button type="button" className="btn-secondary" onClick={() => setTermForm({ name: '', kind: 'Annual', session: meta.session, start_date: '', end_date: '' })}>+ New Exam</button>}
            {meta.can_manage && termId && <button type="button" className="btn-ghost" onClick={() => { const t = meta.terms.find((x) => String(x.id) === termId); setTermForm({ ...t }); }}>Edit Exam</button>}
            {meta.is_management && <button type="button" className="btn-ghost" onClick={() => setGrading({ scale: meta.grading.scale.map((g) => ({ ...g })), pass_percentage: meta.grading.pass_percentage })}>Grading Rules</button>}
          </div>
        </div>
        {meta.terms.length === 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            How result cards work: 1) create the exam here (e.g. “Annual Examination 2026”); 2) in <b>Tests &amp; Marks</b>, add each subject’s paper and choose this exam under “Counts towards result card of”; 3) type the marks. The result card then adds up every subject.
          </p>
        )}
      </div>

      {sheet && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <div>
              <h3 style={{ margin: 0 }}>{sheet.term.name} — {sectionLabel(sheet.section)}</h3>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {sheet.stats.students} students · {sheet.stats.passed} passed · {sheet.stats.failed} failed{sheet.stats.incomplete ? ` · ${sheet.stats.incomplete} with marks missing` : ''}
                {' · '}{sheet.approval ? <>✔ Approved by <b>{sheet.approval.approved_by_name}</b> ({sheet.approval.approved_by_designation}), {fmtDateTime(sheet.approval.approved_at)}</> : 'Not approved yet'}
              </span>
            </div>
            <div className="actions-cell">
              {sheet.students.length > 0 && sheet.subjects.length > 0 && (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => printElement(sheetRef.current, 'Result sheet')}>🖨 Print result sheet</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => downloadFile(`/results/terms/${termId}/sections/${sectionId}/cards.pdf`, `result-cards-${sectionId}.pdf`)}>🖨 Print all result cards</button>
                  <button type="button" className="btn-secondary btn-sm" disabled={sendingAll} onClick={async () => {
                    if (!window.confirm(`Send every student's ${sheet.term.name} result card (PDF) to their parent on WhatsApp / email?`)) return;
                    setSendingAll(true);
                    try {
                      const r = await api.post(`/results/terms/${termId}/sections/${sectionId}/cards/send-all`, { force: !sheet.approval });
                      toast.success(`Sent ${r.sent} of ${r.students}${r.simulated ? ` · ${r.simulated} not sent (WhatsApp / email not set up in Settings)` : ''}${r.no_contact ? ` · ${r.no_contact} without a phone / email` : ''}${r.failed ? ` · ${r.failed} failed` : ''}`);
                    } catch (err) { toast.error(err.message); } finally { setSendingAll(false); }
                  }}>{sendingAll ? 'Sending…' : '📤 Send all to parents'}</button>
                  <PrintSheet ref={sheetRef} title={`Result Sheet — ${sheet.term.name}`}
                    meta={`${sectionLabel(sheet.section)}  ·  ${sheet.stats.passed} passed, ${sheet.stats.failed} failed${sheet.approval ? `  ·  Approved by ${sheet.approval.approved_by_name}` : ''}`}
                    columns={[{ key: 'roll', label: 'Roll' }, { key: 'name', label: 'Student' }, ...sheet.subjects.map((x) => ({ key: `s${x.subject_id}`, label: `${x.subject_name} /${x.total}` })), { key: 'total', label: 'Total' }, { key: 'pct', label: '%' }, { key: 'grade', label: 'Grade' }, { key: 'status', label: 'Result' }, { key: 'pos', label: 'Pos.' }]}
                    rows={sheet.students.map((st) => ({ roll: st.roll_number ?? '', name: st.full_name, ...Object.fromEntries(sheet.subjects.map((x) => { const r = st.subjects[x.subject_id] || {}; return [`s${x.subject_id}`, r.absent ? 'Abs' : (r.obtained ?? '—')]; })), total: `${st.obtained}/${st.total}`, pct: pct(st.percentage), grade: st.grade, status: st.status, pos: st.position || '' }))}
                    signatures={['Class Teacher', 'Exam Controller', 'Principal']} />
                </>
              )}
              {sheet.can_approve && !sheet.approval && <button type="button" className="btn-success btn-sm" onClick={() => approve(false)}>Approve results</button>}
              {sheet.can_approve && sheet.approval && <button type="button" className="btn-ghost btn-sm" onClick={() => approve(true)}>Remove approval</button>}
            </div>
          </div>

          {sheet.subjects.length === 0 ? (
            <p className="muted">No papers are linked to this exam for this class yet. In <b>Tests &amp; Marks</b>, add a test for each subject and choose “{sheet.term.name}”.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="result-sheet">
                <thead>
                  <tr>
                    <th>Roll</th><th>Student</th>
                    {sheet.subjects.map((s) => <th key={s.subject_id} title={`Out of ${s.total}, pass ${s.pass_marks}`}>{s.subject_name}<div className="muted" style={{ fontWeight: 400, fontSize: '0.7rem' }}>/{s.total}</div></th>)}
                    <th>Total</th><th>%</th><th>Grade</th><th>Result</th><th>Pos.</th><th>Class teacher remarks</th><th>Principal remarks</th><th />
                  </tr>
                </thead>
                <tbody>
                  {sheet.students.map((s) => (
                    <tr key={s.student_id}>
                      <td>{s.roll_number ?? '—'}</td>
                      <td><Link to={`/students/${s.student_id}`}>{s.full_name}</Link></td>
                      {sheet.subjects.map((sub) => {
                        const r = s.subjects[sub.subject_id] || {};
                        return <td key={sub.subject_id} className={r.obtained !== null && r.obtained !== undefined && !r.pass ? 'fail-cell' : ''}>{r.absent ? 'Abs' : (r.obtained ?? <span className="muted">—</span>)}</td>;
                      })}
                      <td>{s.obtained}/{s.total}</td><td><b>{pct(s.percentage)}</b></td><td>{s.grade}</td>
                      <td><Badge variant={s.status === 'Pass' ? 'success' : s.status === 'Fail' ? 'danger' : 'warning'}>{s.status}</Badge></td>
                      <td>{s.position || '—'}</td>
                      <td><input dir="auto" disabled={!sheet.can_edit_teacher_remarks} value={remarks[s.student_id]?.teacher_remarks || ''} onChange={(e) => setRemark(s.student_id, 'teacher_remarks', e.target.value)} style={{ minWidth: 150 }} /></td>
                      <td><input dir="auto" disabled={!sheet.can_edit_principal_remarks} value={remarks[s.student_id]?.principal_remarks || ''} onChange={(e) => setRemark(s.student_id, 'principal_remarks', e.target.value)} style={{ minWidth: 150 }} /></td>
                      <td><div className="actions-cell">
                        <ShareButtons iconOnly path={`/results/terms/${termId}/sections/${sectionId}/cards.pdf?student_id=${s.student_id}`} filenameBase={`result-card-${s.student_code}`} />
                        <IconButton icon="send" tone="default" label="Send PDF to parent on WhatsApp" onClick={() => sendCard(s)} />
                        <button type="button" className="btn-ghost btn-sm" title="Open WhatsApp chat with the result typed in" onClick={() => chat(s)}>Chat</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(sheet.can_edit_teacher_remarks || sheet.can_edit_principal_remarks) && sheet.subjects.length > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" disabled={!dirty} onClick={saveRemarks}>Save Remarks</button>
              {dirty && <span className="muted">Unsaved changes</span>}
            </div>
          )}
        </div>
      )}

      {termForm && (
        <Modal title={termForm.id ? 'Edit Exam' : 'New Exam'} onClose={() => setTermForm(null)}>
          <form onSubmit={saveTerm}>
            <div className="field"><label>Name</label><input required dir="auto" value={termForm.name} placeholder="e.g. Annual Examination 2026" onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label>Type</label><select value={termForm.kind} onChange={(e) => setTermForm({ ...termForm, kind: e.target.value })}>{meta.term_kinds.map((k) => <option key={k}>{k}</option>)}</select></div>
              <div className="field"><label>Session</label><input value={termForm.session || ''} placeholder="e.g. 2026-27" onChange={(e) => setTermForm({ ...termForm, session: e.target.value })} /></div>
              <div className="field"><label>Starts</label><DateInput value={termForm.start_date || ''} onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })} /></div>
              <div className="field"><label>Result date</label><DateInput value={termForm.end_date || ''} onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })} /></div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setTermForm(null)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {grading && (
        <Modal title="Grading Rules" onClose={() => setGrading(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.put('/results/grading', grading);
              toast.success('Grading rules saved');
              setGrading(null);
              reloadMeta();
              load();
            } catch (err) {
              toast.error(err.message);
            }
          }}>
            <div className="field"><label>Pass percentage (overall and per subject)</label><input type="number" min="0" max="100" value={grading.pass_percentage} onChange={(e) => setGrading({ ...grading, pass_percentage: e.target.value })} /></div>
            <table>
              <thead><tr><th>Grade</th><th>From %</th><th>Remark</th><th /></tr></thead>
              <tbody>
                {grading.scale.map((g, i) => (
                  <tr key={i}>
                    <td><input value={g.grade} style={{ width: 60 }} onChange={(e) => setGrading({ ...grading, scale: grading.scale.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)) })} /></td>
                    <td><input type="number" min="0" max="100" value={g.min} style={{ width: 80 }} onChange={(e) => setGrading({ ...grading, scale: grading.scale.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} /></td>
                    <td><input value={g.remark} onChange={(e) => setGrading({ ...grading, scale: grading.scale.map((x, j) => (j === i ? { ...x, remark: e.target.value } : x)) })} /></td>
                    <td><IconButton icon="trash" tone="danger" label="Remove" onClick={() => setGrading({ ...grading, scale: grading.scale.filter((_, j) => j !== i) })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setGrading({ ...grading, scale: [...grading.scale, { grade: '', min: 0, remark: '' }] })}>+ Add grade</button>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setGrading(null)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
