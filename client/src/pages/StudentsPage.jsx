import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import Avatar from '../components/Avatar';
import StudentFormModal from '../components/StudentFormModal';
import IconButton, { IconLink } from '../components/IconButton';
import LeaveSchoolModal, { ReadmitModal } from '../components/LeaveSchoolModal';


export default function StudentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('students', 'manage');

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState([]);

  const [showAdmit, setShowAdmit] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [showPromote, setShowPromote] = useState(false);
  const [promoteFromSection, setPromoteFromSection] = useState('');
  const [promoteToSection, setPromoteToSection] = useState('');
  const [showIdCards, setShowIdCards] = useState(false);
  const [idCardSection, setIdCardSection] = useState('');
  const [enrollment, setEnrollment] = useState('current');
  const [classFilter, setClassFilter] = useState({ class_id: '', section_id: '' });
  const [leaving, setLeaving] = useState(null);
  const [readmitting, setReadmitting] = useState(null);

  async function load(page = pagination.page, q = search, enr = enrollment, cf = classFilter) {
    setLoading(true);
    try {
      const byClass = cf.class_id || cf.section_id;
      const data = await api.get(`/students?search=${encodeURIComponent(q)}&page=${page}&limit=${byClass ? 500 : pagination.limit}&enrollment=${enr}&class_id=${cf.class_id}&section_id=${cf.section_id}${byClass ? '&sort=class' : ''}`);
      setRows(data.rows);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1, '');
    api.get('/academics/sections').then(setSections).catch(() => {});
  }, []);

  function handleSearch(value) {
    setSearch(value);
    load(1, value);
  }

  async function openEdit(id) {
    try {
      setEditing(await api.get(`/students/${id}`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function archiveStudent(id) {
    if (!window.confirm('Archive this student record?')) return;
    try {
      await api.del(`/students/${id}`);
      toast.success('Student archived');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitImport(e) {
    e.preventDefault();
    if (!importFile) return;
    const formData = new FormData();
    formData.append('file', importFile);
    try {
      const result = await api.upload('/students/import', formData);
      setImportResult(result);
      toast.success(`Imported ${result.created} students`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitPromotion(e) {
    e.preventDefault();
    try {
      const studentsInSection = await api.get(`/students?section_id=${promoteFromSection}&limit=1000`);
      const ids = studentsInSection.rows.map((s) => s.id);
      const result = await api.post('/students/promote', { student_ids: ids, to_section_id: Number(promoteToSection) });
      toast.success(`Promoted ${result.promoted} students`);
      setShowPromote(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Students</h2>
        {canManage && (
          <div className="page-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowIdCards(true)}>Print ID Cards</button>
            <button type="button" className="btn-secondary" onClick={() => setShowPromote(true)}>Promote</button>
            <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}>Bulk Import</button>
            <button type="button" className="btn-secondary" onClick={() => downloadFile('/students/export', 'students.xlsx')}>Export</button>
            <button type="button" onClick={() => setShowAdmit(true)}>+ Admit Student</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="seg" style={{ marginBottom: 12 }}>
          {[['current', 'Current students'], ['left', 'Left school'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" className={enrollment === k ? 'active' : ''} onClick={() => { setEnrollment(k); load(1, search, k); }}>{label}</button>
          ))}
        </div>
        <div className="row filters" style={{ marginBottom: 10 }}>
          <span className="muted">Class-wise:</span>
          <select value={classFilter.class_id} onChange={(e) => { const cf = { class_id: e.target.value, section_id: '' }; setClassFilter(cf); load(1, search, enrollment, cf); }}>
            <option value="">All classes</option>{[...new Map(sections.map((x) => [x.class_id, x.class_name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={classFilter.section_id} onChange={(e) => { const cf = { ...classFilter, section_id: e.target.value }; setClassFilter(cf); load(1, search, enrollment, cf); }}>
            <option value="">All sections</option>{sections.filter((x) => !classFilter.class_id || String(x.class_id) === String(classFilter.class_id)).map((x) => <option key={x.id} value={x.id}>{x.class_name} - {x.name}</option>)}
          </select>
          {(classFilter.class_id || classFilter.section_id) && <span className="muted">{pagination.total} student(s), sorted by class &amp; roll no.</span>}
        </div>
        <DataTable
          loading={loading}
          search={search}
          onSearchChange={handleSearch}
          searchPlaceholder="Search by name, code or admission no…"
          columns={[
            { key: 'photo_path', label: '', render: (r) => <Avatar photo={r.photo_path} name={r.full_name} size={34} /> },
            { key: 'student_code', label: 'Code' },
            { key: 'full_name', label: 'Name', render: (r) => <Link to={`/students/${r.id}`}>{r.full_name}</Link> },
            { key: 'class_name', label: 'Class', render: (r) => `${r.class_name || '-'} ${r.section_name || ''}` },
            { key: 'roll_number', label: 'Roll' },
            { key: 'parent_name', label: 'Guardian' },
            { key: 'status', label: 'Status', render: (r) => (
              <span title={r.leaving_reason || ''}>
                <Badge>{r.status}</Badge>
                {r.left_on && <span className="muted" style={{ fontSize: '0.75rem', display: 'block' }}>{r.leaving_type || 'Left'} · {r.left_on}</span>}
              </span>
            ) }
          ]}
          rows={rows}
          pagination={{ ...pagination, onPageChange: (p) => load(p) }}
          rowActions={canManage ? (row) => (
            <>
              <IconLink icon="view" label="View profile" to={`/students/${row.id}`} LinkComponent={Link} />
              <IconButton icon="edit" tone="primary" label="Edit" onClick={() => openEdit(row.id)} />
              {['Left', 'Graduated'].includes(row.status)
                ? <IconButton icon="rejoin" tone="success" label="Re-admit" onClick={() => setReadmitting(row)} />
                : <IconButton icon="relieve" tone="default" label="Left school (transfer / moved)" onClick={() => setLeaving(row)} />}
              <IconButton icon="archive" tone="default" label="Archive" onClick={() => archiveStudent(row.id)} />
            </>
          ) : undefined}
        />
      </div>

      {leaving && <LeaveSchoolModal student={leaving} onClose={() => setLeaving(null)} onDone={() => { setLeaving(null); load(); }} />}
      {readmitting && <ReadmitModal student={readmitting} sections={sections} onClose={() => setReadmitting(null)} onDone={() => { setReadmitting(null); load(); }} />}
      {(showAdmit || editing) && (
        <StudentFormModal
          student={editing}
          sections={sections}
          onClose={() => { setShowAdmit(false); setEditing(null); }}
          onSaved={() => { setShowAdmit(false); setEditing(null); load(); }}
        />
      )}

      {showImport && (
        <Modal title="Bulk Import Students" onClose={() => { setShowImport(false); setImportResult(null); }}>
          <ol className="muted import-steps">
            <li>Download the template. The yellow sample row shows a row the app accepts; delete it and add your students (it is skipped if left).</li>
            <li><b>Sr No</b> counts each class automatically, and the <b>Classes &amp; Sections</b> sheet shows how many students each class has in the file, so none get left out.</li>
            <li>Classes and sections are taken from the sheet. <i>1</i> matches <i>Class 1</i>, and a class or section that doesn't exist yet is created.</li>
          </ol>
          <button type="button" className="btn-secondary" onClick={() => downloadFile('/students/import/template', 'student-import-template.xlsx')}>Download Template</button>
          <form onSubmit={submitImport} style={{ marginTop: 14 }}>
            <div className="field"><input type="file" accept=".xlsx" onChange={(e) => setImportFile(e.target.files[0])} /></div>
            <button type="submit" disabled={!importFile}>Upload &amp; Import</button>
          </form>
          {importResult && (
            <div className="stack" style={{ marginTop: 14 }}>
              <p><b>{importResult.created}</b> students imported.</p>
              {importResult.byClass?.length > 0 && (
                <table className="import-summary">
                  <thead><tr><th>Class - Section</th><th className="num">Imported</th></tr></thead>
                  <tbody>{importResult.byClass.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{c.count}</td></tr>)}</tbody>
                </table>
              )}
              {(importResult.createdClasses?.length > 0 || importResult.createdSections?.length > 0) && (
                <p className="muted" style={{ margin: 0 }}>New from the sheet: {[...(importResult.createdClasses || []).map((c) => `class ${c}`), ...(importResult.createdSections || []).map((x) => `section ${x}`)].join(', ')}</p>
              )}
              {importResult.skipped?.length > 0 && (
                <details><summary className="muted">{importResult.skipped.length} rows skipped</summary>
                  <ul>{importResult.skipped.map((f, i) => <li key={i} className="muted">Row {f.row} · {f.full_name}: {f.reason}</li>)}</ul>
                </details>
              )}
              {importResult.failed.length > 0 && (
                <div>
                  <p style={{ color: 'var(--danger)' }}>{importResult.failed.length} {importResult.failed.length === 1 ? 'row' : 'rows'} failed. Fix these in the sheet and upload again (rows already imported are skipped):</p>
                  <ul>{importResult.failed.map((f, i) => <li key={i} className="muted">Row {f.row} · {f.full_name}: {f.error}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {showPromote && (
        <Modal title="Promote Students" onClose={() => setShowPromote(false)}>
          <form onSubmit={submitPromotion}>
            <div className="field"><label>From Section</label>
              <select required value={promoteFromSection} onChange={(e) => setPromoteFromSection(e.target.value)}>
                <option value="">Select section</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name} ({s.student_count} students)</option>)}
              </select>
            </div>
            <div className="field"><label>To Section</label>
              <select required value={promoteToSection} onChange={(e) => setPromoteToSection(e.target.value)}>
                <option value="">Select section</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setShowPromote(false)}>Cancel</button>
              <button type="submit">Promote All Students</button>
            </div>
          </form>
        </Modal>
      )}

      {showIdCards && (
        <Modal title="Print ID Cards" onClose={() => setShowIdCards(false)}>
          <p className="muted">Generates a printable PDF with one card per student (CR80 size, 8 per A4 sheet) for the whole section — cut and laminate for a class set.</p>
          <div className="field"><label>Section</label>
            <select value={idCardSection} onChange={(e) => setIdCardSection(e.target.value)}>
              <option value="">Select section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name} ({s.student_count} students)</option>)}
            </select>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={() => setShowIdCards(false)}>Cancel</button>
            <button
              type="button"
              disabled={!idCardSection}
              onClick={() => { downloadFile(`/students/id-cards.pdf?section_id=${idCardSection}`, 'student-id-cards.pdf'); setShowIdCards(false); }}
            >
              Download ID Cards
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
