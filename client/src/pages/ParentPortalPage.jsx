import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import UpcomingPanel from '../components/UpcomingPanel';
import ChildResults from '../components/ChildResults';
import StudentHistory from '../components/StudentHistory';

function ChildCard({ child }) {
  const [attendance, setAttendance] = useState([]);
  const [invoices, setInvoices] = useState([]);
  useEffect(() => {
    api.get(`/attendance/student/${child.id}`).then(setAttendance).catch(() => {});
    api.get(`/fees/invoices?student_id=${child.id}`).then(setInvoices).catch(() => {});
  }, [child.id]);

  const present = attendance.filter((a) => a.status === 'Present').length;

  return (
    <div className="card">
      <h3>{child.full_name} <span className="muted">({child.class_name} - {child.section_name})</span></h3>
      <p><b>Attendance:</b> {present} / {attendance.length} days present</p>
      <ChildResults studentId={child.id} code={child.student_code} />
      <StudentHistory studentId={child.id} code={child.student_code} canSend={false} />
      <h4>Fee Invoices</h4>
      <table>
        <thead><tr><th>Invoice</th><th>Period</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
        <tbody>
          {invoices.map((i) => <tr key={i.id}><td>{i.invoice_number}</td><td>{i.period_label}</td><td>{i.total_amount}</td><td>{i.paid_amount}</td><td><Badge>{i.status}</Badge></td></tr>)}
          {invoices.length === 0 && <tr><td colSpan={5} className="muted">No invoices yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function ParentPortalPage() {
  const { user } = useAuth();
  const [children, setChildren] = useState(null);

  useEffect(() => {
    if (user.parent_id) api.get(`/parents/${user.parent_id}/students`).then(setChildren).catch(() => setChildren([]));
    else setChildren([]);
  }, [user.parent_id]);

  return (
    <div>
      <div className="page-header"><h2>My Children</h2></div>
      <UpcomingPanel />
      {children === null ? <p className="muted">Loading…</p> : children.length === 0 ? (
        <div className="card"><p className="muted">No student records are linked to your account yet. Please contact the school office.</p></div>
      ) : children.map((c) => <ChildCard key={c.id} child={c} />)}
    </div>
  );
}
