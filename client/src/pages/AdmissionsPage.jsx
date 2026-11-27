import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import StudentFormModal from '../components/StudentFormModal';
import { useAcademicRefs } from '../utils/useRefs';

const STATUSES = ['New', 'Contacted', 'Test Scheduled', 'Approved', 'Admitted', 'Rejected', 'Withdrawn'];
const VARIANT = { New: 'warning', Contacted: 'muted', 'Test Scheduled': 'warning', Approved: 'success', Admitted: 'success', Rejected: 'danger', Withdrawn: 'muted' };

export default function AdmissionsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const refs = useAcademicRefs();
  const [stats, setStats] = useState({});
  const [reload, setReload] = useState(0);
  const [admitting, setAdmitting] = useState(null);
  const canManage = can('admissions', 'manage');

  useEffect(() => { api.get('/admissions/stats').then((s) => setStats(s.counts)).catch(() => {}); }, [reload]);

  const fields = [
    { key: 'full_name', label: 'Student name', required: true },
    { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'] },
    { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { key: 'class_id', label: 'Class applied for', type: 'select', options: refs.classOptions },
    { key: 'parent_name', label: 'Parent / guardian' },
    { key: 'parent_phone', label: 'Parent phone', type: 'tel' },
    { key: 'parent_email', label: 'Parent email', type: 'email' },
    { key: 'previous_school', label: 'Previous school' },
    { key: 'address', label: 'Address', full: true },
    { key: 'source', label: 'How they heard of us', placeholder: 'e.g. Walk-in, Facebook, Referral' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, noBlank: true, default: 'New' },
    { key: 'test_date', label: 'Test / interview date', type: 'date' },
    { key: 'test_result', label: 'Test result' },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true }
  ];

  function admit(e) {
    const sectionForClass = refs.sections.find((s) => String(s.class_id) === String(e.class_id));
    setAdmitting({
      enquiry: e,
      initial: {
        full_name: e.full_name, gender: e.gender || '', date_of_birth: e.date_of_birth || '', parent_name: e.parent_name || '',
        parent_phone: e.parent_phone || '', parent_email: e.parent_email || '', address: e.address || '',
        section_id: sectionForClass ? String(sectionForClass.id) : ''
      }
    });
  }

  async function admitted(studentId) {
    try {
      await api.post(`/admissions/enquiries/${admitting.enquiry.id}/admitted`, { student_id: studentId });
      toast.success(`${admitting.enquiry.full_name} admitted — enquiry closed`);
    } catch (err) {
      toast.error(err.message);
    }
    setAdmitting(null);
    setReload((r) => r + 1);
  }

  return (
    <div>
      <div className="page-header"><h2>Admissions</h2></div>
      <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        {STATUSES.map((s) => (
          <div key={s} className="card stat-tile" style={{ marginBottom: 0 }}>
            <span className="stat-label">{s}</span><span className="stat-value">{stats[s] || 0}</span>
          </div>
        ))}
      </div>
      <CrudManager
        endpoint="/admissions/enquiries"
        noun="enquiry"
        addLabel="New Enquiry"
        canManage={canManage}
        reloadKey={reload}
        fields={fields}
        filters={[
          { key: 'status', label: 'All statuses', type: 'select', options: STATUSES },
          { key: 'class_id', label: 'All classes', type: 'select', options: refs.classOptions },
          { key: 'search', label: 'Search name / phone…' }
        ]}
        columns={[
          { key: 'created_at', label: 'Date', render: (r) => String(r.created_at).slice(0, 10) },
          { key: 'full_name', label: 'Student', render: (r) => <b>{r.full_name}</b> },
          { key: 'class_name', label: 'Class' },
          { key: 'parent_name', label: 'Parent', render: (r) => <>{r.parent_name}<div className="muted" style={{ fontSize: '0.75rem' }}>{r.parent_phone}</div></> },
          { key: 'test_date', label: 'Test', render: (r) => (r.test_date ? `${r.test_date}${r.test_result ? ` · ${r.test_result}` : ''}` : '—') },
          { key: 'status', label: 'Status', render: (r) => <Badge variant={VARIANT[r.status]}>{r.status}</Badge> },
          { key: 'student_code', label: 'Student', render: (r) => (r.student_id ? <Link to={`/students/${r.student_id}`} onClick={(e) => e.stopPropagation()}>{r.student_code}</Link> : '') }
        ]}
        rowActions={(r) => (canManage && !r.student_id && !['Rejected', 'Withdrawn'].includes(r.status)
          ? <IconButton icon="check" tone="success" label="Admit — create the student record" onClick={() => admit(r)} />
          : null)}
        emptyMessage="No enquiries yet. Add one when a parent calls or visits."
        describe={(r) => r.full_name}
        toPayload={(b) => ({ ...b, class_id: b.class_id ? Number(b.class_id) : null })}
      />
      {admitting && (
        <StudentFormModal sections={refs.sections} initial={admitting.initial} onClose={() => setAdmitting(null)} onSaved={admitted} />
      )}
    </div>
  );
}
