import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Badge from '../components/Badge';
import Avatar from '../components/Avatar';
import TeacherFormModal from '../components/TeacherFormModal';
import EmploymentModal, { EmploymentHistory } from '../components/EmploymentModal';
import DateInput from '../components/DateInput';

export default function TeacherProfilePage() {
  const { id } = useParams();
  const toast = useToast();
  const [teacher, setTeacher] = useState(null);
  const [leaveForm, setLeaveForm] = useState({ leave_type: 'Casual', start_date: '', end_date: '', reason: '' });

  const [editing, setEditing] = useState(false);
  const [employment, setEmployment] = useState(false);
  const [attendance, setAttendance] = useState([]);

  async function load() {
    const data = await api.get(`/teachers/${id}`);
    setTeacher(data);
    api.get(`/attendance/teacher/${id}`).then(setAttendance).catch(() => {});
  }
  useEffect(() => { load(); }, [id]);

  async function applyLeave(e) {
    e.preventDefault();
    try {
      await api.post(`/teachers/${id}/leaves`, leaveForm);
      toast.success('Leave request submitted');
      setLeaveForm({ leave_type: 'Casual', start_date: '', end_date: '', reason: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function decideLeave(leaveId, status) {
    try {
      await api.put(`/teachers/leaves/${leaveId}/decision`, { status });
      toast.success(`Leave ${status.toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!teacher) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div className="row" style={{ margin: 0, gap: 14 }}>
          <Avatar photo={teacher.photo_path} name={teacher.full_name} size={64} />
          <h2 style={{ margin: 0 }}>{teacher.full_name}</h2>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <button type="button" onClick={() => setEditing(true)}>Edit Details / Photo</button>
          <button type="button" className="btn-secondary" onClick={() => setEmployment(true)}>{teacher.status === 'Relieved' ? 'Re-join' : 'Relieve'}</button>
          <Link to="/teachers" className="btn-ghost btn-sm">← Back to Teachers</Link>
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <h3>Profile</h3>
          <p><b>Code:</b> {teacher.teacher_code}</p>
          <p><b>Designation:</b> {teacher.designation || '-'}</p>
          <p><b>Email:</b> {teacher.email || '-'} &nbsp; <b>Phone:</b> {teacher.phone || '-'}</p>
          <p><b>Qualification:</b> {teacher.qualification || '-'}</p>
          <p><b>Hire Date:</b> {teacher.hire_date || '-'} &nbsp; <b>Type:</b> {teacher.employment_type || '-'}</p>
          <p><b>Gender:</b> {teacher.gender || '-'} &nbsp; <b>DOB:</b> {teacher.date_of_birth || '-'}</p>
          <p><b>Address:</b> {teacher.address || '-'}</p>
          <p><b>Status:</b> <Badge>{teacher.status}</Badge></p>
        </div>
        <div className="card">
          <h3>Assigned Classes &amp; Subjects</h3>
          {teacher.assignments.length === 0 ? <p className="muted">No assignments yet — add them from Classes &amp; Subjects.</p> : (
            <table>
              <thead><tr><th>Class</th><th>Subject</th></tr></thead>
              <tbody>{teacher.assignments.map((a) => <tr key={a.id}><td>{a.class_name} - {a.section_name}</td><td>{a.subject_name}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <TeacherFormModal teacher={teacher} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}

      {employment && (
        <EmploymentModal kind="teacher" person={teacher} onClose={() => setEmployment(false)} onDone={() => { setEmployment(false); load(); }} />
      )}
      {teacher.relieved_on && <div className="sync-banner sync-error">Relieved on {teacher.relieved_on}{teacher.relieve_reason ? ` — ${teacher.relieve_reason}` : ''}</div>}
      <div className="card">
        <h3>Employment History</h3>
        <EmploymentHistory key={`${teacher.status}-${teacher.relieved_on}`} kind="teacher" personId={teacher.id} />
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>Joined {teacher.hire_date || '—'}. Relieve / re-join events appear above.</p>
      </div>

      <div className="card">
        <h3>Attendance (last 30 days on record)</h3>
        {attendance.length === 0 ? <p className="muted">No attendance recorded yet. Mark it from Attendance → Teachers.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>How</th><th>Remarks</th></tr></thead>
            <tbody>{attendance.slice(0, 30).map((a) => (
              <tr key={a.id}><td>{a.attendance_date}</td><td><Badge>{a.status}</Badge></td><td>{a.source === 'auto' ? 'Auto (class attendance)' : 'Marked by office'}</td><td>{a.remarks || '-'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Leave Management</h3>
        <table>
          <thead><tr><th>Type</th><th>From</th><th>To</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {teacher.leaves.map((l) => (
              <tr key={l.id}>
                <td>{l.leave_type}</td><td>{l.start_date}</td><td>{l.end_date}</td>
                <td><Badge>{l.status}</Badge></td>
                <td>
                  {l.status === 'Pending' && (
                    <>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => decideLeave(l.id, 'Approved')}>Approve</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => decideLeave(l.id, 'Rejected')}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={applyLeave} className="form-grid" style={{ marginTop: 14 }}>
          <div className="field"><label>Leave Type</label>
            <select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}>
              <option>Casual</option><option>Sick</option><option>Annual</option><option>Unpaid</option>
            </select>
          </div>
          <div className="field"><label>Reason</label><input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} /></div>
          <div className="field"><label>Start Date</label><DateInput required value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })} /></div>
          <div className="field"><label>End Date</label><DateInput required value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} /></div>
          <button type="submit">Apply for Leave</button>
        </form>
      </div>
    </div>
  );
}
