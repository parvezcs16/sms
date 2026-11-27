import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

const TABS = ['Classes', 'Sections', 'Subjects', 'Rooms', 'Assignments'];

const BLANK = {
  Classes: { name: '', sort_order: 0 },
  Sections: { class_id: '', name: '', capacity: 40, room_id: '', class_teacher_id: '' },
  Subjects: { name: '', code: '' },
  Rooms: { name: '', capacity: 40 },
  Assignments: { section_id: '', subject_id: '', teacher_id: '' }
};
const ENDPOINT = { Classes: 'classes', Sections: 'sections', Subjects: 'subjects', Rooms: 'rooms', Assignments: 'assignments' };
const SINGULAR = { Classes: 'Class', Sections: 'Section', Subjects: 'Subject', Rooms: 'Room', Assignments: 'Assignment' };

export default function AcademicsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'Classes';
  const setTab = (t) => setParams(t === 'Classes' ? {} : { tab: t }, { replace: true });
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  // One form per tab; editingId != null means the form is editing that row.
  const [forms, setForms] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  async function loadAll() {
    try {
      const [c, s, sub, r, t, a] = await Promise.all([
        api.get('/academics/classes'), api.get('/academics/sections'), api.get('/academics/subjects'),
        api.get('/academics/rooms'), api.get('/teachers?limit=500'), api.get('/academics/assignments')
      ]);
      setClasses(c); setSections(s); setSubjects(sub); setRooms(r); setTeachers(t.rows.filter((x) => x.status !== 'Relieved')); setAssignments(a);
    } catch (err) {
      toast.error(err.message);
    }
  }
  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setEditingId(null); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const form = forms[tab];
  const setForm = (next) => setForms({ ...forms, [tab]: next });
  const set = (f, num = false) => (e) => setForm({ ...form, [f]: num ? Number(e.target.value) : e.target.value });

  function switchTab(t) {
    setTab(t);
    setEditingId(null);
    setForms(BLANK);
  }

  // Clicking a row loads it into the form on the right; clicking it again
  // (or "+ New") switches the form back to adding a new one.
  function selectRow(row, label) {
    if (editingId === row.id) return cancelEdit();
    const pick = Object.fromEntries(Object.keys(BLANK[tab]).map((k) => [k, row[k] === null || row[k] === undefined ? '' : String(row[k])]));
    setForms({ ...forms, [tab]: pick });
    setEditingId(row.id);
    setEditingLabel(label);
    return undefined;
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingLabel('');
    setForms({ ...forms, [tab]: BLANK[tab] });
  }

  async function submit(e) {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/academics/${ENDPOINT[tab]}/${editingId}`, tab === 'Assignments' ? { teacher_id: Number(form.teacher_id) } : form);
        toast.success(`${SINGULAR[tab]} updated`);
      } else {
        await api.post(`/academics/${ENDPOINT[tab]}`, form);
        toast.success(`${SINGULAR[tab]} added`);
      }
      cancelEdit();
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeSelected() {
    const verb = tab === 'Assignments' ? 'Remove' : 'Delete';
    if (!window.confirm(`${verb} ${SINGULAR[tab].toLowerCase()} "${editingLabel}"?`)) return;
    try {
      await api.del(`/academics/${ENDPOINT[tab]}/${editingId}`);
      toast.success(`${SINGULAR[tab]} ${verb === 'Remove' ? 'removed' : 'deleted'}`);
      cancelEdit();
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Props for a clickable table row.
  const rowProps = (row, label) => ({
    className: `row-selectable${editingId === row.id ? ' row-selected' : ''}`,
    onClick: () => selectRow(row, label),
    title: editingId === row.id ? 'Click again to stop editing' : 'Click to edit'
  });

  const formFooter = (
    <div className="row form-actions">
      <button type="submit">{editingId ? 'Update' : tab === 'Assignments' ? 'Assign' : `Add ${SINGULAR[tab]}`}</button>
      {editingId && <button type="button" className="btn-danger" onClick={removeSelected}>{tab === 'Assignments' ? 'Remove' : 'Delete'}</button>}
      {editingId && <button type="button" className="btn-ghost" onClick={cancelEdit}>+ New</button>}
    </div>
  );
  const formTitle = editingId ? `Edit ${SINGULAR[tab]} — ${editingLabel}` : `Add ${SINGULAR[tab]}`;
  const hint = <p className="muted" style={{ fontSize: '0.8rem', marginTop: -4 }}>Click a row to edit or delete it.</p>;

  return (
    <div>
      <div className="page-header"><h2>Classes &amp; Subjects</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? '' : 'btn-ghost'} onClick={() => switchTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Classes' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Existing Classes</h3>{hint}
            <table><thead><tr><th>Name</th><th>Order</th><th>Sections</th></tr></thead>
              <tbody>{classes.map((c) => (
                <tr key={c.id} {...rowProps(c, c.name)}><td>{c.name}</td><td>{c.sort_order}</td><td>{sections.filter((s) => s.class_id === c.id).map((s) => s.name).join(', ') || '-'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>{formTitle}</h3>
            <form onSubmit={submit}>
              <div className="field"><label>Name</label><input required value={form.name} onChange={set('name')} placeholder="e.g. Class 6" /></div>
              <div className="field"><label>Sort Order</label><input type="number" value={form.sort_order} onChange={set('sort_order', true)} /></div>
              {formFooter}
            </form>
          </div>
        </div>
      )}

      {tab === 'Sections' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Existing Sections</h3>{hint}
            <table><thead><tr><th>Class</th><th>Section</th><th>Students</th><th>Class Teacher</th><th>Room</th></tr></thead>
              <tbody>{sections.map((s) => (
                <tr key={s.id} {...rowProps(s, `${s.class_name} - ${s.name}`)}><td>{s.class_name}</td><td>{s.name}</td><td>{s.student_count}</td><td>{s.class_teacher_name || '-'}</td><td>{s.room_name || '-'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>{formTitle}</h3>
            <form onSubmit={submit}>
              <div className="field"><label>Class</label>
                <select required value={form.class_id} onChange={set('class_id')}>
                  <option value="">Select class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Section Name</label><input required value={form.name} onChange={set('name')} placeholder="e.g. A" /></div>
              <div className="field"><label>Capacity</label><input type="number" value={form.capacity} onChange={set('capacity', true)} /></div>
              <div className="field"><label>Room</label>
                <select value={form.room_id} onChange={set('room_id')}>
                  <option value="">None</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Class Teacher</label>
                <select value={form.class_teacher_id} onChange={set('class_teacher_id')}>
                  <option value="">None</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              {formFooter}
            </form>
          </div>
        </div>
      )}

      {tab === 'Subjects' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Existing Subjects</h3>{hint}
            <table><thead><tr><th>Name</th><th>Code</th></tr></thead>
              <tbody>{subjects.map((s) => <tr key={s.id} {...rowProps(s, s.name)}><td>{s.name}</td><td>{s.code || '-'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>{formTitle}</h3>
            <form onSubmit={submit}>
              <div className="field"><label>Name</label><input required value={form.name} onChange={set('name')} /></div>
              <div className="field"><label>Code</label><input value={form.code} onChange={set('code')} /></div>
              {formFooter}
            </form>
          </div>
        </div>
      )}

      {tab === 'Rooms' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Existing Rooms</h3>{hint}
            <table><thead><tr><th>Name</th><th>Capacity</th></tr></thead>
              <tbody>{rooms.map((r) => <tr key={r.id} {...rowProps(r, r.name)}><td>{r.name}</td><td>{r.capacity}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>{formTitle}</h3>
            <form onSubmit={submit}>
              <div className="field"><label>Name</label><input required value={form.name} onChange={set('name')} /></div>
              <div className="field"><label>Capacity</label><input type="number" value={form.capacity} onChange={set('capacity', true)} /></div>
              {formFooter}
            </form>
          </div>
        </div>
      )}

      {tab === 'Assignments' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Subject Teachers</h3>{hint}
            <table><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th></tr></thead>
              <tbody>{assignments.map((a) => (
                <tr key={a.id} {...rowProps(a, `${a.subject_name} (${a.class_name} - ${a.section_name})`)}>
                  <td>{a.class_name} - {a.section_name}</td><td>{a.subject_name}</td><td>{a.teacher_name}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>{editingId ? `Change Teacher — ${editingLabel}` : 'Assign Subject Teacher'}</h3>
            <form onSubmit={submit}>
              <div className="field"><label>Section</label>
                <select required disabled={Boolean(editingId)} value={form.section_id} onChange={set('section_id')}>
                  <option value="">Select section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Subject</label>
                <select required disabled={Boolean(editingId)} value={form.subject_id} onChange={set('subject_id')}>
                  <option value="">Select subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Teacher</label>
                <select required value={form.teacher_id} onChange={set('teacher_id')}>
                  <option value="">Select teacher</option>
                  {form.teacher_id && !teachers.some((t) => String(t.id) === String(form.teacher_id)) && <option value={form.teacher_id}>(relieved teacher)</option>}
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              {formFooter}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
