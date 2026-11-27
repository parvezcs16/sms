import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import UpcomingPanel from '../components/UpcomingPanel';
import ChildResults from '../components/ChildResults';

export default function StudentPortalPage() {
  const { user } = useAuth();
  const [student, setStudent] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    if (!user.student_id) return;
    api.get(`/students/${user.student_id}`).then(setStudent).catch(() => {});
    api.get(`/attendance/student/${user.student_id}`).then(setAttendance).catch(() => {});
    api.get(`/fees/invoices?student_id=${user.student_id}`).then(setInvoices).catch(() => {});
  }, [user.student_id]);

  if (!user.student_id) return <div className="card"><p className="muted">No student record is linked to your account yet.</p></div>;
  if (!student) return <p className="muted">Loading…</p>;

  const present = attendance.filter((a) => a.status === 'Present').length;

  return (
    <div>
      <div className="page-header"><h2>My Records</h2></div>
      <UpcomingPanel />
      <div className="card"><ChildResults studentId={user.student_id} code={student.student_code} /></div>
      <div className="grid two-col">
        <div className="card">
          <h3>Profile</h3>
          <p><b>Class:</b> {student.class_name} - {student.section_name}</p>
          <p><b>Roll No:</b> {student.roll_number || '-'}</p>
          <p><b>Attendance:</b> {present} / {attendance.length} days present</p>
        </div>
        <div className="card">
          <h3>Fee Invoices</h3>
          <table>
            <thead><tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((i) => <tr key={i.id}><td>{i.invoice_number}</td><td>{i.total_amount}</td><td>{i.paid_amount}</td><td><Badge>{i.status}</Badge></td></tr>)}
              {invoices.length === 0 && <tr><td colSpan={4} className="muted">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Attendance History</h3>
        <table>
          <thead><tr><th>Date</th><th>Status</th></tr></thead>
          <tbody>{attendance.slice(0, 30).map((a) => <tr key={a.id}><td>{a.attendance_date}</td><td><Badge>{a.status}</Badge></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
