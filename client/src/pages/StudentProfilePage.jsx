import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import ShareButtons from '../components/ShareButtons';
import Avatar from '../components/Avatar';
import StudentFormModal from '../components/StudentFormModal';
import StudentHistory from '../components/StudentHistory';


export default function StudentProfilePage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const toast = useToast();
  const canManage = can('students', 'manage');
  const [student, setStudent] = useState(null);
  const [qr, setQr] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [docType, setDocType] = useState('Birth Certificate');
  const [docFile, setDocFile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState([]);

  async function openEdit() {
    if (!sections.length) {
      try { setSections(await api.get('/academics/sections')); } catch (err) { toast.error(err.message); return; }
    }
    setEditing(true);
  }

  async function load() {
    const data = await api.get(`/students/${id}`);
    setStudent(data);
    api.get(`/students/${id}/qrcode`).then((r) => setQr(r.dataUrl)).catch(() => {});
    api.get(`/attendance/student/${id}`).then(setAttendance).catch(() => {});
  }

  useEffect(() => { load(); }, [id]);

  async function uploadDocument(e) {
    e.preventDefault();
    if (!docFile) return;
    const formData = new FormData();
    formData.append('document', docFile);
    formData.append('doc_type', docType);
    try {
      await api.upload(`/students/${id}/documents`, formData);
      toast.success('Document uploaded');
      setDocFile(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeDocument(docId) {
    await api.del(`/students/documents/${docId}`);
    load();
  }

  if (!student) return <p className="muted">Loading…</p>;

  const presentCount = attendance.filter((a) => a.status === 'Present').length;

  return (
    <div>
      <div className="page-header">
        <div className="row" style={{ margin: 0, gap: 14 }}>
          <Avatar photo={student.photo_path} name={student.full_name} size={64} />
          <h2 style={{ margin: 0 }}>{student.full_name}</h2>
        </div>
        <div className="row" style={{ margin: 0 }}>
          {canManage && <button type="button" onClick={openEdit}>Edit Details / Photo</button>}
          <Link to="/students" className="btn-ghost btn-sm">← Back to Students</Link>
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <h3>Profile</h3>
          <p><b>Student Code:</b> {student.student_code}</p>
          <p><b>Admission No:</b> {student.admission_number}</p>
          <p><b>Class:</b> {student.class_name} - {student.section_name}</p>
          <p><b>Roll Number:</b> {student.roll_number || '-'}</p>
          <p><b>Gender:</b> {student.gender || '-'} &nbsp; <b>DOB:</b> {student.date_of_birth || '-'}</p>
          <p><b>Blood Group:</b> {student.blood_group || '-'} &nbsp; <b>Admitted:</b> {student.admission_date || '-'}</p>
          <p><b>Guardian:</b> {student.parent_name || '-'}{student.parent_relation ? ` (${student.parent_relation})` : ''} — {student.parent_phone || '-'}</p>
          <p><b>Address:</b> {student.address || '-'}</p>
          <p><b>Status:</b> <Badge>{student.status}</Badge></p>
          <p><b>Attendance so far:</b> {presentCount} / {attendance.length} present</p>
          {(can('results', 'view') || user.teacher_id) && (
            <p><Link to={`/results?tab=progress&student=${id}`}>📈 Progress report &amp; marks</Link></p>
          )}
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>Student ID</h3>
          {qr && <img src={qr} alt="Student QR code" width={160} height={160} />}
          <p className="muted">{student.student_code}</p>
          <a href={`/api/students/${id}/barcode`} target="_blank" rel="noreferrer"><img src={`/api/students/${id}/barcode`} alt="barcode" style={{ maxWidth: '100%', marginTop: 8 }} /></a>
          {canManage && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              <ShareButtons path={`/students/${id}/id-card.pdf`} filenameBase={`id-card-${student.student_code}`} />
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <div className="card">
          <h3>Documents</h3>
          <div className="stack">
            {student.documents.length === 0 ? <p className="muted">No documents uploaded.</p> : student.documents.map((d) => (
              <div key={d.id} className="row">
                <span>{d.doc_type}: {d.file_name}</span>
                <a className="btn-ghost btn-sm" href={`/uploads/${d.file_path}`} target="_blank" rel="noreferrer">Open</a>
                <button type="button" className="btn-ghost btn-sm" onClick={() => removeDocument(d.id)}>Delete</button>
              </div>
            ))}
          </div>
          <form onSubmit={uploadDocument} className="row" style={{ marginTop: 14 }}>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ maxWidth: 220 }}>
              <option>Birth Certificate</option><option>Previous Report Card</option><option>ID Proof</option><option>Other</option>
            </select>
            <input type="file" onChange={(e) => setDocFile(e.target.files[0])} style={{ maxWidth: 260 }} />
            <button type="submit" disabled={!docFile}>Upload</button>
          </form>
        </div>
      )}

      {editing && (
        <StudentFormModal
          student={student}
          sections={sections}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}

      <StudentHistory studentId={id} code={student.student_code} canSend={can('fees', 'view')} />
    </div>
  );
}
