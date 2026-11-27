import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { localDateStr } from '../utils/date';
import { printElement } from '../utils/print';
import Modal from '../components/Modal';
import Certificate, { TEMPLATE_INFO, isAward, fmtDate } from '../components/Certificate';
import { BRAND } from '../brand';
import DateInput from '../components/DateInput';

const CATEGORIES = [
  { key: 'position', label: 'Position (1st / 2nd / 3rd)', icon: '🏆' },
  { key: 'appreciation', label: 'Appreciation', icon: '🌟' },
  { key: 'participation', label: 'Participation', icon: '🎖️' },
  { key: 'leaving', label: 'School Leaving', icon: '📜' },
  { key: 'provisional', label: 'Provisional', icon: '📄' },
  { key: 'character', label: 'Character', icon: '🧾' }
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const TEMPLATES = ['classic', 'royal', 'modern'];
const CONDUCT = ['Excellent', 'Very Good', 'Good', 'Satisfactory'];
const MM = 96 / 25.4; // px per mm

const DEFAULTS = {
  position: { position: '1st', event: 'Annual Examination', session: '' },
  appreciation: { reason: 'outstanding performance and good conduct', event: '' },
  participation: { event: 'Annual Sports Day', held_on: '', role: '' },
  leaving: { conduct: 'Good', dues: 'All dues cleared', reason: '' },
  provisional: { exam: 'Annual Examination', result: 'passed', purpose: 'admission in another institution' },
  character: { conduct: 'good', activities: '' }
};

function useSchool() {
  const [school, setSchool] = useState({ name: BRAND.fullName, logo: '', contact: '' });
  useEffect(() => {
    api.get('/settings').then((s) => setSchool({
      name: s.school_name || BRAND.fullName,
      logo: s.school_logo ? `/uploads/${encodeURIComponent(s.school_logo)}` : '/chand-emblem.png',
      contact: [String(s.address || '').replace(/\s*\n\s*/g, ', ').trim(), s.school_phone ? `Ph: ${s.school_phone}` : ''].filter(Boolean).join('  ·  '),
      session: s.academic_year || ''
    })).catch(() => {});
    // Stamp chosen for certificates in Settings → School Branding → Stamps.
    api.get('/settings/stamps').then((r) => {
      const kind = r.usage && r.usage.certificates;
      const file = kind && r.stamps[kind];
      setSchool((x) => ({ ...x, stamp: file ? `/uploads/${encodeURIComponent(file)}` : '' }));
    }).catch(() => {});
  }, []);
  return school;
}

// Scales an A4 page to the width of its box (the print copy stays full size).
function Scaled({ cert, school, printRef, maxWidth }) {
  const boxRef = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pageW = (isAward(cert.category) ? 297 : 210) * MM;
  const pageH = (isAward(cert.category) ? 210 : 297) * MM;
  const scale = Math.min(1, (maxWidth ? Math.min(w, maxWidth) : w) / pageW);
  return (
    <div ref={boxRef} style={{ width: '100%' }}>
      <div style={{ width: pageW * scale, height: pageH * scale, overflow: 'hidden', margin: '0 auto', boxShadow: '0 4px 18px rgba(0,0,0,.18)', borderRadius: 4 }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: pageW }}>
          <div ref={printRef}><Certificate cert={cert} school={school} /></div>
        </div>
      </div>
    </div>
  );
}

function printCert(el, cert) {
  printElement(el, `${CAT_LABEL[cert.category]} ${cert.certificate_number || ''}`.trim(), { page: isAward(cert.category) ? 'A4 landscape' : 'A4 portrait', margin: '0' });
}

function F({ label, children, wide }) {
  return <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}><label>{label}</label>{children}</div>;
}

function CreateTab({ school, canManage, onIssued }) {
  const toast = useToast();
  const [category, setCategory] = useState('position');
  const [template, setTemplate] = useState('classic');
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [issueDate, setIssueDate] = useState(localDateStr());
  const [student, setStudent] = useState({});
  const [fields, setFields] = useState(DEFAULTS.position);
  const [busy, setBusy] = useState(false);
  const printRef = useRef(null);

  useEffect(() => { api.get('/academics/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => {
    if (!classId) { setStudents([]); return; }
    api.get(`/certificates/students?class_id=${classId}`).then(setStudents).catch(() => setStudents([]));
  }, [classId]);

  function chooseCategory(key) {
    setCategory(key);
    setFields({ ...DEFAULTS[key], ...(key === 'position' || key === 'provisional' ? { session: school.session || '' } : {}) });
  }

  async function chooseStudent(id) {
    setStudentId(id);
    if (!id) { setStudent({}); return; }
    try {
      const s = await api.get(`/certificates/student/${id}`);
      setName(s.full_name);
      const cls = [s.class_name, s.section_name].filter(Boolean).join('-');
      setStudent({
        gender: s.gender || '', parent_name: s.parent_name || '', class_label: cls, admission_number: s.admission_number || '',
        roll_number: s.roll_number ? String(s.roll_number) : '', date_of_birth: s.date_of_birth || '', admission_date: s.admission_date || '',
        left_on: s.left_on || '', from: s.admission_date || '', to: s.left_on || ''
      });
      if (s.leaving_reason && category === 'leaving') setFields((f) => ({ ...f, reason: f.reason || s.leaving_reason }));
    } catch (err) { toast.error(err.message); }
  }

  const data = { ...student, ...fields };
  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });
  const setS = (k) => (e) => setStudent({ ...student, [k]: e.target.value });
  const draft = { category, template, recipient_name: name || 'Student Name', issue_date: issueDate, certificate_number: '', data };

  async function issue() {
    if (!name.trim()) { toast.error('Choose a student or type the name'); return; }
    if (!isAward(category) && !studentId) {
      if (!window.confirm('No student is selected from the register. Issue this certificate with the typed details anyway?')) return;
    }
    setBusy(true);
    try {
      const title = fields.event || fields.exam || fields.reason || '';
      const issued = await api.post('/certificates', { category, template, student_id: studentId || null, recipient_name: name.trim(), title, issue_date: issueDate, data });
      toast.success(`Issued ${issued.certificate_number}`);
      onIssued(issued);
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  const sample = useMemo(() => ({ category, recipient_name: 'Student Name', issue_date: localDateStr(), certificate_number: '', data: { ...DEFAULTS[category], parent_name: 'Father Name', class_label: '5-A', gender: 'Male' } }), [category]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="cert-cats">
        {CATEGORIES.map((c) => (
          <button key={c.key} type="button" className={`cert-cat${category === c.key ? ' active' : ''}`} onClick={() => chooseCategory(c.key)}>
            <span className="cert-cat-icon">{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3>Template</h3>
        <div className="cert-templates">
          {TEMPLATES.map((t) => (
            <button key={t} type="button" className={`cert-tpl${template === t ? ' active' : ''}`} onClick={() => setTemplate(t)}>
              <Scaled cert={{ ...sample, template: t }} school={school} printRef={null} />
              <b>{TEMPLATE_INFO[t].label}</b>
              <small className="muted">{TEMPLATE_INFO[t].note}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="cert-work">
        <div className="card" style={{ marginBottom: 0 }}>
          <h3>Details</h3>
          <form className="cert-form" onSubmit={(e) => { e.preventDefault(); issue(); }}>
            <div className="form-grid">
              <F label="Class"><select value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(''); }}><option value="">— choose —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
              <F label="Student"><select value={studentId} disabled={!classId} onChange={(e) => chooseStudent(e.target.value)}>
                <option value="">{classId ? '— choose —' : 'choose a class first'}</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.section_name ? ` (${s.section_name})` : ''}{s.status && s.status !== 'Active' ? ` · ${s.status}` : ''}</option>)}
              </select></F>
              <F label="Name on certificate"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type a name or choose a student" /></F>
              <F label="Father / Guardian name"><input value={student.parent_name || ''} onChange={setS('parent_name')} /></F>
              <F label="Gender"><select value={student.gender || ''} onChange={setS('gender')}><option value="">—</option><option>Male</option><option>Female</option></select></F>
              <F label="Class (as printed)"><input value={student.class_label || ''} onChange={setS('class_label')} placeholder="e.g. 5-A" /></F>

              {category === 'position' && <>
                <F label="Position"><select value={fields.position} onChange={set('position')}><option>1st</option><option>2nd</option><option>3rd</option></select></F>
                <F label="In (exam / competition)"><input value={fields.event || ''} onChange={set('event')} /></F>
                <F label="Session"><input value={fields.session || ''} onChange={set('session')} placeholder="e.g. 2026-27" /></F>
                <F label="Remarks (optional)"><input value={fields.remarks || ''} onChange={set('remarks')} /></F>
              </>}
              {category === 'appreciation' && <>
                <F label="In appreciation of" wide><input value={fields.reason || ''} onChange={set('reason')} /></F>
                <F label="Event (optional)"><input value={fields.event || ''} onChange={set('event')} /></F>
              </>}
              {category === 'participation' && <>
                <F label="Event"><input value={fields.event || ''} onChange={set('event')} /></F>
                <F label="Held on"><DateInput value={fields.held_on || ''} onChange={set('held_on')} /></F>
                <F label="Took part as (optional)"><input value={fields.role || ''} onChange={set('role')} placeholder="e.g. Speaker, Athlete" /></F>
              </>}
              {category === 'leaving' && <>
                <F label="Admission No."><input value={student.admission_number || ''} onChange={setS('admission_number')} /></F>
                <F label="Date of birth"><DateInput value={student.date_of_birth || ''} onChange={setS('date_of_birth')} /></F>
                <F label="Date of admission"><DateInput value={student.admission_date || ''} onChange={setS('admission_date')} /></F>
                <F label="Date of leaving"><DateInput value={student.left_on || ''} onChange={setS('left_on')} /></F>
                <F label="Reason for leaving"><input value={fields.reason || ''} onChange={set('reason')} placeholder="e.g. Parents' transfer" /></F>
                <F label="Conduct"><select value={fields.conduct} onChange={set('conduct')}>{CONDUCT.map((c) => <option key={c}>{c}</option>)}</select></F>
                <F label="School dues"><input value={fields.dues || ''} onChange={set('dues')} /></F>
                <F label="Remarks"><input value={fields.remarks || ''} onChange={set('remarks')} /></F>
              </>}
              {category === 'provisional' && <>
                <F label="Roll No."><input value={student.roll_number || ''} onChange={setS('roll_number')} /></F>
                <F label="Admission No."><input value={student.admission_number || ''} onChange={setS('admission_number')} /></F>
                <F label="Examination"><input value={fields.exam || ''} onChange={set('exam')} /></F>
                <F label="Session"><input value={fields.session || ''} onChange={set('session')} /></F>
                <F label="Result"><select value={fields.result} onChange={set('result')}><option value="passed">Passed</option><option value="appeared in">Appeared in</option></select></F>
                <F label="Grade"><input value={fields.grade || ''} onChange={set('grade')} /></F>
                <F label="Marks obtained"><input value={fields.marks_obtained || ''} onChange={set('marks_obtained')} /></F>
                <F label="Total marks"><input value={fields.total_marks || ''} onChange={set('total_marks')} /></F>
                <F label="Purpose" wide><input value={fields.purpose || ''} onChange={set('purpose')} /></F>
              </>}
              {category === 'character' && <>
                <F label="Admission No."><input value={student.admission_number || ''} onChange={setS('admission_number')} /></F>
                <F label="Conduct / character"><select value={fields.conduct} onChange={set('conduct')}>{CONDUCT.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}</select></F>
                <F label="Studied from"><DateInput value={student.from || ''} onChange={setS('from')} /></F>
                <F label="Studied to"><DateInput value={student.to || ''} onChange={setS('to')} /></F>
                <F label="Activities (optional)" wide><input value={fields.activities || ''} onChange={set('activities')} placeholder="e.g. debates, sports and the school choir" /></F>
              </>}

              <F label="Date of issue"><DateInput value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></F>
              <F label="Signature (left)"><input value={fields.sig_left || ''} onChange={set('sig_left')} placeholder={category === 'leaving' ? 'Prepared by (Clerk)' : 'Class Teacher'} /></F>
              <F label="Signature (right)"><input value={fields.sig_right || ''} onChange={set('sig_right')} placeholder="Principal" /></F>
            </div>
            <div className="row">
              {canManage
                ? <button type="submit" disabled={busy}>{busy ? 'Issuing…' : '✔ Issue certificate'}</button>
                : <span className="muted">You have view-only access — ask an Admin to issue certificates.</span>}
              <button type="button" className="btn-ghost" onClick={() => printCert(printRef.current, draft)}>Print draft</button>
            </div>
            <p className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>Issuing gives the certificate a serial number and saves it in the register, where you can reprint or cancel it later.</p>
          </form>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h3>Preview</h3>
          <Scaled cert={draft} school={school} printRef={printRef} />
        </div>
      </div>
    </div>
  );
}

function ViewModal({ cert, school, onClose, onCancelled, canManage }) {
  const toast = useToast();
  const ref = useRef(null);
  async function cancel() {
    const reason = window.prompt('Why is this certificate being cancelled?', '');
    if (reason === null) return;
    try { await api.post(`/certificates/${cert.id}/cancel`, { reason }); toast.success('Certificate cancelled'); onCancelled(); } catch (err) { toast.error(err.message); }
  }
  return (
    <Modal title={`${CAT_LABEL[cert.category]} · ${cert.certificate_number}`} onClose={onClose} wide
      footer={<>
        {canManage && !cert.cancelled_at && <button type="button" className="btn-ghost" onClick={cancel}>Cancel certificate</button>}
        <button type="button" onClick={() => printCert(ref.current, cert)}>🖨 Print</button>
      </>}>
      <Scaled cert={cert} school={school} printRef={ref} />
      {cert.cancelled_at && <p style={{ color: 'var(--danger)', marginTop: 10 }}>Cancelled {fmtDate(cert.cancelled_at)}{cert.cancel_reason ? ` — ${cert.cancel_reason}` : ''}</p>}
    </Modal>
  );
}

function RegisterTab({ school, canManage, refreshKey, openCert }) {
  const [rows, setRows] = useState([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/certificates?category=${category}&search=${encodeURIComponent(search)}`).then(setRows).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [category, search, refreshKey]);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All types</option>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input placeholder="Search name, serial no. or event" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>
      {rows.length === 0 ? <p className="muted">No certificates issued yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Serial No.</th><th>Type</th><th>Issued to</th><th>For</th><th>Date</th><th>Issued by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.cancelled_at ? { opacity: 0.6 } : undefined}>
                  <td><b>{r.certificate_number}</b></td>
                  <td>{CAT_LABEL[r.category]}{r.category === 'position' && r.data.position ? ` · ${r.data.position}` : ''}</td>
                  <td>{r.recipient_name}{r.data.class_label ? <span className="muted"> ({r.data.class_label})</span> : null}</td>
                  <td>{r.title || '—'}</td>
                  <td>{fmtDate(r.issue_date)}</td>
                  <td>{r.issued_by_name || '—'}</td>
                  <td>{r.cancelled_at ? <span style={{ color: 'var(--danger)' }}>Cancelled</span> : <span style={{ color: 'var(--success)' }}>Issued</span>}</td>
                  <td><button type="button" className="btn-secondary btn-sm" onClick={() => openCert(r)}>View / Print</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canManage && <p className="muted" style={{ fontSize: '0.78rem' }}>View-only access.</p>}
    </div>
  );
}

export default function CertificatesPage() {
  const { can } = useAuth();
  const canManage = can('certificates', 'manage');
  const school = useSchool();
  const [tab, setTab] = useState('create');
  const [viewing, setViewing] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Certificates</h2>
          <p style={{ margin: 0 }}>Position, appreciation and participation awards, plus leaving, provisional and character certificates — three templates each.</p>
        </div>
        <div className="seg">
          <button type="button" className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Create</button>
          <button type="button" className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}>Register</button>
        </div>
      </div>
      {tab === 'create'
        ? <CreateTab school={school} canManage={canManage} onIssued={(c) => { setRefreshKey((k) => k + 1); setViewing(c); }} />
        : <RegisterTab school={school} canManage={canManage} refreshKey={refreshKey} openCert={setViewing} />}
      {viewing && <ViewModal cert={viewing} school={school} canManage={canManage} onClose={() => setViewing(null)}
        onCancelled={() => { setViewing(null); setRefreshKey((k) => k + 1); }} />}
    </div>
  );
}
