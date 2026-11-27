import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function TimetablePage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const canEdit = can('timetable', 'manage');

  const [mode, setMode] = useState('class');
  const [sections, setSections] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [entries, setEntries] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [form, setForm] = useState({ subject_id: '', teacher_id: '', room_id: '' });

  useEffect(() => {
    api.get('/academics/sections').then(setSections);
    api.get('/teachers?limit=200').then((r) => setTeachers(r.rows));
    api.get('/academics/subjects').then(setSubjects);
    api.get('/academics/rooms').then(setRooms);
    api.get('/timetable/periods').then(setPeriods);
  }, []);

  useEffect(() => {
    if (mode === 'class' && sectionId) api.get(`/timetable/section/${sectionId}`).then(setEntries);
    if (mode === 'teacher' && teacherId) api.get(`/timetable/teacher/${teacherId}`).then(setEntries);
  }, [mode, sectionId, teacherId]);

  function entryFor(day, periodId) {
    return entries.find((e) => e.day_of_week === day && e.period_id === periodId);
  }

  async function saveCell(day, periodId) {
    try {
      await api.post('/timetable', { section_id: sectionId, day_of_week: day, period_id: periodId, ...form });
      toast.success('Timetable updated');
      setEditingCell(null);
      setForm({ subject_id: '', teacher_id: '', room_id: '' });
      api.get(`/timetable/section/${sectionId}`).then(setEntries);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeCell(entryId) {
    try {
      await api.del(`/timetable/${entryId}`);
      api.get(`/timetable/section/${sectionId}`).then(setEntries);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const blankPeriod = { name: '', start_time: '', end_time: '', order_index: 0 };
  const [periodForm, setPeriodForm] = useState(blankPeriod);
  const [periodEditId, setPeriodEditId] = useState(null);
  const reloadPeriods = () => api.get('/timetable/periods').then(setPeriods);

  async function savePeriod(e) {
    e.preventDefault();
    try {
      if (periodEditId) await api.put(`/timetable/periods/${periodEditId}`, periodForm);
      else await api.post('/timetable/periods', periodForm);
      toast.success(periodEditId ? 'Period updated' : 'Period added');
      setPeriodForm(blankPeriod);
      setPeriodEditId(null);
      reloadPeriods();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deletePeriod(p) {
    if (!window.confirm(`Delete period "${p.name}"?`)) return;
    try {
      await api.del(`/timetable/periods/${p.id}`);
      setPeriodEditId(null);
      setPeriodForm(blankPeriod);
      reloadPeriods();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Timetable</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={mode === 'class' ? '' : 'btn-ghost'} onClick={() => setMode('class')}>By Class</button>
        <button type="button" className={mode === 'teacher' ? '' : 'btn-ghost'} onClick={() => setMode('teacher')}>By Teacher</button>
        {mode === 'class' ? (
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Select section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
          </select>
        ) : (
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Select teacher</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        )}
      </div>

      {((mode === 'class' && sectionId) || (mode === 'teacher' && teacherId)) && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Period</th>{DAYS.slice(1).map((d, i) => <th key={d}>{d}</th>)}</tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b><br /><span className="muted">{p.start_time}-{p.end_time}</span></td>
                    {[1, 2, 3, 4, 5, 6].map((day) => {
                      const entry = entryFor(day, p.id);
                      const cellKey = `${day}-${p.id}`;
                      const editingThis = editingCell === cellKey;
                      return (
                        <td key={day}>
                          {editingThis ? (
                            <div className="stack">
                              <select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                                <option value="">Subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                              <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
                                <option value="">Teacher</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                              </select>
                              <select value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
                                <option value="">Room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                              </select>
                              <div className="row" style={{ margin: 0 }}>
                                <button type="button" className="btn-sm" onClick={() => saveCell(day, p.id)}>Save</button>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingCell(null); setForm({ subject_id: '', teacher_id: '', room_id: '' }); }}>Cancel</button>
                              </div>
                            </div>
                          ) : entry ? (
                            <div>
                              <div>{entry.subject_name}</div>
                              <div className="muted">{mode === 'class' ? entry.teacher_name : `${entry.class_name} - ${entry.section_name}`}</div>
                              {canEdit && mode === 'class' && (
                                <div className="row" style={{ margin: 0 }}>
                                  <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingCell(cellKey); setForm({ subject_id: String(entry.subject_id), teacher_id: String(entry.teacher_id), room_id: entry.room_id ? String(entry.room_id) : '' }); }}>Edit</button>
                                  <button type="button" className="icon-btn btn-sm" title="Clear this slot" onClick={() => removeCell(entry.id)}>✕</button>
                                </div>
                              )}
                            </div>
                          ) : canEdit && mode === 'class' ? (
                            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingCell(cellKey); setForm({ subject_id: '', teacher_id: '', room_id: '' }); }}>+ Add</button>
                          ) : <span className="muted">-</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="grid two-col">
          <div className="card">
            <h3>Periods &amp; Timings</h3>
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: -4 }}>Click a row to edit or delete it.</p>
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Start</th><th>End</th></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr
                    key={p.id}
                    className={`row-selectable${periodEditId === p.id ? ' row-selected' : ''}`}
                    title="Click to edit"
                    onClick={() => {
                      if (periodEditId === p.id) { setPeriodEditId(null); setPeriodForm(blankPeriod); return; }
                      setPeriodEditId(p.id); setPeriodForm({ name: p.name, start_time: p.start_time, end_time: p.end_time, order_index: p.order_index });
                    }}
                  >
                    <td>{p.order_index}</td><td>{p.name}</td><td>{p.start_time}</td><td>{p.end_time}</td>
                  </tr>
                ))}
                {periods.length === 0 && <tr><td colSpan={4} className="muted">No periods yet — add the school day's periods on the right.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>{periodEditId ? 'Edit Period' : 'Add Period'}</h3>
            <form onSubmit={savePeriod}>
              <div className="field"><label>Name</label><input required value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} placeholder="e.g. Period 1, Break" /></div>
              <div className="form-grid">
                <div className="field"><label>Start</label><input type="time" required value={periodForm.start_time} onChange={(e) => setPeriodForm({ ...periodForm, start_time: e.target.value })} /></div>
                <div className="field"><label>End</label><input type="time" required value={periodForm.end_time} onChange={(e) => setPeriodForm({ ...periodForm, end_time: e.target.value })} /></div>
              </div>
              <div className="field"><label>Order</label><input type="number" value={periodForm.order_index} onChange={(e) => setPeriodForm({ ...periodForm, order_index: Number(e.target.value) })} /></div>
              <div className="row form-actions">
                <button type="submit">{periodEditId ? 'Update' : 'Add Period'}</button>
                {periodEditId && <button type="button" className="btn-danger" onClick={() => { const p = periods.find((x) => x.id === periodEditId); if (p) deletePeriod(p); }}>Delete</button>}
                {periodEditId && <button type="button" className="btn-ghost" onClick={() => { setPeriodEditId(null); setPeriodForm(blankPeriod); }}>+ New</button>}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
