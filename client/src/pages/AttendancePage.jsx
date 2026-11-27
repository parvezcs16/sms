import { useEffect, useMemo, useState } from 'react';
import { useFollowToday, onSchoolDayChange } from '../utils/schoolDay';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { localDateStr } from '../utils/date';
import { enqueue, queueKey, removeFromQueue, useAttendanceQueue } from '../utils/attendanceQueue';
import Avatar from '../components/Avatar';
import DateInput from '../components/DateInput';

const SOURCE_LABEL = { auto: 'auto (submitted class attendance)', self: 'self check-in', manual: 'marked by office' };

const STUDENT_STATUSES = ['Present', 'Absent', 'Late', 'Leave'];
const TEACHER_STATUSES = ['Present', 'Absent', 'Late', 'Leave'];
const STAFF_STATUSES = ['Present', 'Absent', 'Leave'];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SyncBanner({ pending, online, onRetry, onDiscard }) {
  if (!pending.length) return null;
  const rejected = pending.filter((p) => p.rejected);
  const waiting = pending.filter((p) => !p.rejected);
  return (
    <div className={`sync-banner ${rejected.length ? 'sync-error' : 'sync-pending'}`}>
      {waiting.length > 0 && (
        <div>
          <b>{waiting.length} attendance submission{waiting.length > 1 ? 's' : ''} saved on this device, not yet on the server.</b>
          <div className="muted">
            {online ? 'Sending…' : 'No connection to the school server. It will be sent automatically as soon as the connection is back.'}
          </div>
          <ul>{waiting.map((p) => <li key={p.key}>{p.label} — {p.payload.attendance_date}</li>)}</ul>
        </div>
      )}
      {rejected.map((p) => (
        <div key={p.key} className="row" style={{ marginTop: 6 }}>
          <span><b>Not accepted:</b> {p.label} ({p.payload.attendance_date}) — {p.error}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onDiscard(p.key)}>Discard</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={onRetry} style={{ marginTop: 8 }}>Retry now</button>
    </div>
  );
}

// Shared roster UI: shows per-row "Saved" vs "Not saved" state, a live tally,
// and a Save bar that stays on screen on phones (it used to sit at the bottom
// of a long list, so it was easy to tap statuses and never actually save).
function Roster({ rows, idKey, statuses, values, setValue, savedFor, queuedKeys, renderLabel, onMarkAll }) {
  return (
    <div className="attendance-roster">
      <div className="row" style={{ margin: '0 0 4px', justifyContent: 'space-between' }}>
        <div className="attendance-tally">
          {statuses.map((s) => (
            <span key={s} className={`tally tally-${s.toLowerCase()}`}>{s}: {rows.filter((r) => values[r[idKey]] === s).length}</span>
          ))}
        </div>
        <div className="row" style={{ margin: 0 }}>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onMarkAll('Present')}>All Present</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onMarkAll('Absent')}>All Absent</button>
        </div>
      </div>
      {rows.map((r) => {
        const id = r[idKey];
        const saved = savedFor(r);
        const current = values[id];
        let state = 'unsaved';
        if (queuedKeys.has(id)) state = 'queued';
        else if (saved && saved === current) state = 'saved';
        else if (saved && saved !== current) state = 'changed';
        return (
          <div key={id} className={`attendance-row row-${state}`}>
            {renderLabel(r)}
            <span className={`save-state save-${state}`}>
              {state === 'saved' && '✓ Saved'}
              {state === 'unsaved' && 'Not saved'}
              {state === 'changed' && 'Changed'}
              {state === 'queued' && 'Waiting to sync'}
            </span>
            <div className="status-btns">
              {statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`status-btn ${current === s ? `active-${s.toLowerCase()}` : ''}`}
                  onClick={() => setValue(id, s)}
                >{s}</button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SaveBar({ count, unsaved, saving, onSave, noun }) {
  return (
    <div className="save-bar">
      <span className={unsaved ? 'save-bar-warn' : 'save-bar-ok'}>
        {unsaved ? `${unsaved} of ${count} ${noun} not saved yet` : `All ${count} ${noun} saved on the server`}
      </span>
      <button type="button" disabled={saving || count === 0} onClick={onSave}>
        {saving ? 'Saving…' : `Save Attendance (${count})`}
      </button>
    </div>
  );
}

function useUnsavedWarning(active) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}

function summarizeSkipped(skipped = []) {
  const corrected = skipped.filter((s) => s.reason === 'corrected_by_admin').length;
  const other = skipped.length - corrected;
  const parts = [];
  if (corrected) parts.push(`${corrected} already corrected by the office (not changed)`);
  if (other) parts.push(`${other} skipped (no longer in this class)`);
  return parts.join('; ');
}

function StudentAttendance({ isManagement, user, queue, syncTick, today }) {
  const toast = useToast();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today);
  useFollowToday(today, date, setDate);
  const [roster, setRoster] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = isManagement
      ? api.get('/academics/sections')
      : api.get('/attendance/my-sections').then((rows) => rows.map((r) => ({ id: r.id, class_name: r.class_name, name: r.section_name })));
    load.then((rows) => {
      setSections(rows);
      if (rows.length === 1) setSectionId(String(rows[0].id));
    }).catch((err) => toast.error(err.message));
  }, [isManagement]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRoster() {
    if (!sectionId) return;
    setLoading(true);
    try {
      const rows = await api.get(`/attendance/section/${sectionId}?date=${date}`);
      setRoster(rows);
      // If this class/date is still waiting in the offline queue, show those
      // (newer) values rather than what the server has.
      const queued = queue.pending.find((p) => p.key === queueKey('students', sectionId, date));
      const queuedMap = {};
      if (queued) queued.payload.records.forEach((rec) => { queuedMap[rec.student_id] = rec.status; });
      const initial = {};
      rows.forEach((r) => { initial[r.student_id] = queuedMap[r.student_id] || r.status || 'Present'; });
      setValues(initial);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRoster(); }, [sectionId, date, syncTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = queueKey('students', sectionId, date);
  const isQueued = queue.pending.some((p) => p.key === key && !p.rejected);
  const queuedIds = useMemo(() => new Set(isQueued ? roster.map((r) => r.student_id) : []), [isQueued, roster]);
  const unsaved = roster.filter((r) => !isQueued && r.status !== values[r.student_id]).length;
  useUnsavedWarning(unsaved > 0 || isQueued);

  async function saveAll() {
    if (!roster.length) return;
    setSaving(true);
    const section = sections.find((s) => String(s.id) === String(sectionId));
    const label = section ? `${section.class_name} - ${section.name}` : `Section ${sectionId}`;
    enqueue({
      key,
      kind: 'students',
      username: user.username,
      label,
      payload: {
        section_id: Number(sectionId),
        attendance_date: date,
        records: roster.map((r) => ({ student_id: r.student_id, status: values[r.student_id] || 'Present' }))
      }
    });
    try {
      const outcome = await queue.flush(true);
      const sent = outcome && outcome.sent.find((s) => s.item.key === key);
      if (sent) {
        const note = summarizeSkipped(sent.result.skipped);
        toast.success(`Saved on the server: ${sent.result.marked} students${note ? ` (${note})` : ''}`);
        await loadRoster();
      } else if (outcome && outcome.offline) {
        toast.info('No connection to the school server — attendance is kept on this device and will sync automatically.');
      } else {
        const failed = outcome && outcome.failed.find((f) => f.item.key === key);
        if (failed) toast.error(failed.error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="row">
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Class / Section</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Select a class</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Date</label>
            <DateInput value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </div>

      {!sectionId ? (
        <div className="card"><p className="muted">{sections.length === 0 ? 'No classes are assigned to you yet — ask an admin to assign you a subject or homeroom.' : 'Select a class to load the attendance roster.'}</p></div>
      ) : loading ? (
        <p className="muted">Loading roster…</p>
      ) : roster.length === 0 ? (
        <div className="card"><p className="muted">No active students in this class.</p></div>
      ) : (
        <div className="card">
          <Roster
            rows={roster}
            idKey="student_id"
            statuses={STUDENT_STATUSES}
            values={values}
            setValue={(id, s) => setValues((v) => ({ ...v, [id]: s }))}
            savedFor={(r) => r.status}
            queuedKeys={queuedIds}
            onMarkAll={(s) => setValues(Object.fromEntries(roster.map((r) => [r.student_id, s])))}
            renderLabel={(r) => (
              <>
                <span className="roll">{r.roll_number || '-'}</span>
                <span className="name">{r.full_name}{r.marked_at && r.status ? <span className="muted marked-at"> · {formatTime(r.marked_at)}</span> : null}</span>
              </>
            )}
          />
          <SaveBar count={roster.length} unsaved={isQueued ? roster.length : unsaved} saving={saving} onSave={saveAll} noun="students" />
        </div>
      )}
    </div>
  );
}

function TeacherAttendance({ user, queue, syncTick, today }) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  useFollowToday(today, date, setDate);
  const [roster, setRoster] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = queueKey('teachers', 'all', date);

  async function loadRoster() {
    setLoading(true);
    try {
      const rows = await api.get(`/attendance/teachers?date=${date}`);
      setRoster(rows);
      const queued = queue.pending.find((p) => p.key === key);
      const queuedMap = {};
      if (queued) queued.payload.records.forEach((rec) => { queuedMap[rec.teacher_id] = rec.status; });
      const initial = {};
      rows.forEach((r) => { initial[r.teacher_id] = queuedMap[r.teacher_id] || r.status || 'Present'; });
      setValues(initial);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadRoster(); }, [date, syncTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const isQueued = queue.pending.some((p) => p.key === key && !p.rejected);
  const queuedIds = useMemo(() => new Set(isQueued ? roster.map((r) => r.teacher_id) : []), [isQueued, roster]);
  const unsaved = roster.filter((r) => !isQueued && r.status !== values[r.teacher_id]).length;
  useUnsavedWarning(unsaved > 0 || isQueued);

  async function saveAll() {
    if (unsaved === 0 && !isQueued) {
      toast.info('Nothing to save — every teacher is already saved for this date.');
      return;
    }
    setSaving(true);
    enqueue({
      key,
      kind: 'teachers',
      username: user.username,
      label: 'Teachers',
      // Only send teachers whose status is new or changed, so an unchanged
      // auto-marked "Present" stays recorded as auto rather than manual.
      payload: {
        attendance_date: date,
        records: roster
          .filter((r) => r.status !== (values[r.teacher_id] || 'Present'))
          .map((r) => ({ teacher_id: r.teacher_id, status: values[r.teacher_id] || 'Present' }))
      }
    });
    try {
      const outcome = await queue.flush(true);
      const sent = outcome && outcome.sent.find((s) => s.item.key === key);
      if (sent) {
        toast.success(`Teacher attendance saved for ${sent.result.marked} teachers`);
        await loadRoster();
      } else if (outcome && outcome.offline) {
        toast.info('No connection to the server — kept on this device, will sync automatically.');
      } else {
        const failed = outcome && outcome.failed.find((f) => f.item.key === key);
        if (failed) toast.error(failed.error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 160 }}>
            <label>Date</label>
            <DateInput value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <p className="muted" style={{ flex: 1, margin: 0 }}>
            Teachers are marked Present automatically when they submit class attendance. Anything you save here is a manual entry and overrides that.
          </p>
        </div>
      </div>
      {loading ? <p className="muted">Loading teachers…</p> : roster.length === 0 ? (
        <div className="card"><p className="muted">No active teachers on record yet — add them from Teachers.</p></div>
      ) : (
        <div className="card">
          <Roster
            rows={roster}
            idKey="teacher_id"
            statuses={TEACHER_STATUSES}
            values={values}
            setValue={(id, s) => setValues((v) => ({ ...v, [id]: s }))}
            savedFor={(r) => r.status}
            queuedKeys={queuedIds}
            onMarkAll={(s) => setValues(Object.fromEntries(roster.map((r) => [r.teacher_id, s])))}
            renderLabel={(r) => (
              <>
                <Avatar photo={r.photo_path} name={r.full_name} size={34} />
                <span className="name">
                  {r.full_name} <span className="muted">({r.designation || r.teacher_code})</span>
                  {r.status && <span className="muted marked-at"> · {SOURCE_LABEL[r.source] || 'manual'}</span>}
                </span>
              </>
            )}
          />
          <SaveBar count={roster.length} unsaved={isQueued ? roster.length : unsaved} saving={saving} onSave={saveAll} noun="teachers" />
        </div>
      )}
    </div>
  );
}

function StaffAttendance({ user, queue, syncTick, today }) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  useFollowToday(today, date, setDate);
  const [roster, setRoster] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = queueKey('staff', 'all', date);

  async function loadRoster() {
    setLoading(true);
    try {
      const rows = await api.get(`/staff/attendance?date=${date}`);
      setRoster(rows);
      const initial = {};
      rows.forEach((r) => { initial[r.staff_id] = r.status || 'Present'; });
      setValues(initial);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadRoster(); }, [date, syncTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const isQueued = queue.pending.some((p) => p.key === key && !p.rejected);
  const queuedIds = useMemo(() => new Set(isQueued ? roster.map((r) => r.staff_id) : []), [isQueued, roster]);
  const unsaved = roster.filter((r) => !isQueued && r.status !== values[r.staff_id]).length;
  useUnsavedWarning(unsaved > 0 || isQueued);

  async function saveAll() {
    const changed = roster.filter((r) => r.status !== (values[r.staff_id] || 'Present'));
    if (!changed.length && !isQueued) { toast.info('Nothing changed — attendance is already saved.'); return; }
    setSaving(true);
    enqueue({
      key,
      kind: 'staff',
      username: user.username,
      label: 'Non-teaching staff',
      payload: { attendance_date: date, records: (changed.length ? changed : roster).map((r) => ({ staff_id: r.staff_id, status: values[r.staff_id] || 'Present' })) }
    });
    try {
      const outcome = await queue.flush(true);
      const sent = outcome && outcome.sent.find((s) => s.item.key === key);
      if (sent) {
        toast.success(`Attendance saved for ${sent.result.marked} staff members`);
        await loadRoster();
      } else if (outcome && outcome.offline) {
        toast.info('No connection to the server — kept on this device, will sync automatically.');
      } else {
        const failed = outcome && outcome.failed.find((f) => f.item.key === key);
        if (failed) toast.error(failed.error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div style={{ minWidth: 160, maxWidth: 220 }}>
          <label>Date</label>
          <DateInput value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {loading ? <p className="muted">Loading roster…</p> : roster.length === 0 ? (
        <div className="card"><p className="muted">No staff members on record yet — add some from Non-Teaching Staff.</p></div>
      ) : (
        <div className="card">
          <Roster
            rows={roster}
            idKey="staff_id"
            statuses={STAFF_STATUSES}
            values={values}
            setValue={(id, s) => setValues((v) => ({ ...v, [id]: s }))}
            savedFor={(r) => r.status}
            queuedKeys={queuedIds}
            onMarkAll={(s) => setValues(Object.fromEntries(roster.map((r) => [r.staff_id, s])))}
            renderLabel={(r) => <span className="name">{r.full_name} <span className="muted">({r.category_name})</span>{r.status && <span className="muted marked-at"> · {SOURCE_LABEL[r.source] || 'manual'}</span>}</span>}
          />
          <SaveBar count={roster.length} unsaved={isQueued ? roster.length : unsaved} saving={saving} onSave={saveAll} noun="staff" />
        </div>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { user, can } = useAuth();
  const toast = useToast();
  // "Attendance" permission = every class + teacher & staff attendance.
  const isManagement = can('attendance', 'manage');
  const [mode, setMode] = useState('students');
  const [refreshKey, setRefreshKey] = useState(0);
  // "Today" comes from the school server, not this device's clock (a phone
  // with a wrong date/time zone used to save attendance under tomorrow).
  const [today, setToday] = useState(null);
  useEffect(() => {
    const check = () => api.get('/attendance/server-date')
      .then((r) => setToday(r.date))
      .catch(() => setToday((t) => t || localDateStr()));
    check();
    // A window left open past midnight moves on to the new day by itself.
    const offDay = onSchoolDayChange((d) => { setToday(d); setRefreshKey((k) => k + 1); });
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      offDay();
    };
  }, []);
  const clockMismatch = today && today !== localDateStr();

  // Background sync of anything queued earlier (e.g. marked while the phone was
  // off Wi-Fi, or before the login expired).
  const queue = useAttendanceQueue(user.username, (outcome) => {
    toast.success(`Synced ${outcome.sent.length} saved attendance submission${outcome.sent.length > 1 ? 's' : ''} to the server`);
    setRefreshKey((k) => k + 1);
  });

  const tabs = [
    { id: 'students', label: 'Students' },
    ...(isManagement ? [{ id: 'teachers', label: 'Teachers' }, { id: 'staff', label: 'Staff' }] : [])
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Mark Attendance</h2>
        {tabs.length > 1 && (
          <div className="row" style={{ margin: 0 }}>
            {tabs.map((t) => (
              <button key={t.id} type="button" className={mode === t.id ? '' : 'btn-ghost'} onClick={() => setMode(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
      {clockMismatch && (
        <div className="sync-banner sync-error">
          <b>This device's date is wrong.</b> It says {localDateStr()}, but today on the school server is {today}.
          Attendance will be saved for {today}. Please set this device's date &amp; time to automatic.
        </div>
      )}
      <SyncBanner
        pending={queue.pending}
        online={queue.online}
        onRetry={() => queue.flush(false)}
        onDiscard={(key) => { if (window.confirm('Discard this unsent attendance? It will not be saved.')) removeFromQueue(key); }}
      />
      {!today ? <p className="muted">Checking today's date with the school server…</p>
        : mode === 'teachers' && isManagement ? <TeacherAttendance key={today} user={user} queue={queue} syncTick={refreshKey} today={today} />
          : mode === 'staff' && isManagement ? <StaffAttendance key={today} user={user} queue={queue} syncTick={refreshKey} today={today} />
            : <StudentAttendance key={today} isManagement={isManagement} user={user} queue={queue} syncTick={refreshKey} today={today} />}
    </div>
  );
}
