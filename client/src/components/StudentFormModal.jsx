import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import PhotoInput from './PhotoInput';
import DateInput from './DateInput';

const blank = {
  full_name: '', gender: '', date_of_birth: '', blood_group: '', section_id: '', roll_number: '', admission_date: '',
  parent_name: '', parent_relation: 'Guardian', parent_phone: '', parent_email: '', address: '', status: 'Active',
  create_login: false, username: '', password: ''
};

function fromStudent(s) {
  return {
    ...blank,
    full_name: s.full_name || '',
    gender: s.gender || '',
    date_of_birth: s.date_of_birth || '',
    blood_group: s.blood_group || '',
    section_id: s.section_id ? String(s.section_id) : '',
    roll_number: s.roll_number ?? '',
    admission_date: s.admission_date || '',
    parent_name: s.parent_name || '',
    parent_phone: s.parent_phone || '',
    parent_email: s.parent_email || '',
    parent_relation: s.parent_relation || 'Guardian',
    address: s.address || '',
    status: s.status || 'Active'
  };
}

// Used for both new admissions and editing an existing student, so the two
// can never drift apart. The photo is uploaded right after the record saves.
export default function StudentFormModal({ student, sections, onClose, onSaved, initial }) {
  const toast = useToast();
  const editing = Boolean(student);
  const [form, setForm] = useState(() => (editing ? fromStudent(student) : { ...blank, ...(initial || {}) }));
  const [photo, setPhoto] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(student?.photo_path || null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm(fromStudent(student));
      setCurrentPhoto(student.photo_path || null);
    }
  }, [student]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function removePhoto() {
    if (!editing || !window.confirm('Remove this student\'s photo?')) return;
    try {
      await api.del(`/students/${student.id}/photo`);
      setCurrentPhoto(null);
      toast.success('Photo removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let id = student?.id;
      if (editing) {
        const { create_login, username, password, ...fields } = form; // eslint-disable-line no-unused-vars
        await api.put(`/students/${id}`, fields);
      } else {
        const created = await api.post('/students', form);
        id = created.id;
      }
      if (photo) {
        const fd = new FormData();
        fd.append('photo', photo);
        try {
          await api.upload(`/students/${id}/photo`, fd);
        } catch (err) {
          toast.error(`Student saved, but the photo failed to upload: ${err.message}`);
        }
      }
      toast.success(editing ? 'Student details updated' : 'Student admitted successfully');
      onSaved(id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? `Edit Student — ${student.full_name}` : 'Admit New Student'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <PhotoInput label="Student Photo" currentPhoto={currentPhoto} file={photo} onChange={setPhoto} onRemove={removePhoto} />
        <div className="form-grid">
          <div className="field"><label>Full Name *</label><input required value={form.full_name} onChange={set('full_name')} /></div>
          <div className="field"><label>Gender</label>
            <select value={form.gender} onChange={set('gender')}>
              <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <div className="field"><label>Date of Birth</label><DateInput value={form.date_of_birth} onChange={set('date_of_birth')} /></div>
          <div className="field"><label>Blood Group</label>
            <select value={form.blood_group} onChange={set('blood_group')}>
              <option value="">Select</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="field"><label>Class / Section *</label>
            <select required value={form.section_id} onChange={set('section_id')}>
              <option value="">Select section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Roll Number</label><input type="number" value={form.roll_number} onChange={set('roll_number')} /></div>
          <div className="field"><label>Admission Date</label><DateInput value={form.admission_date} onChange={set('admission_date')} /></div>
          {editing && (
            <div className="field"><label>Status</label>
              <select value={form.status} onChange={set('status')}>
                <option>Active</option><option>Inactive</option><option>Left</option><option>Graduated</option>
              </select>
            </div>
          )}
          <div className="field"><label>Guardian Name</label><input value={form.parent_name} onChange={set('parent_name')} /></div>
          <div className="field"><label>Relation</label>
            <select value={form.parent_relation} onChange={set('parent_relation')}>
              <option>Father</option><option>Mother</option><option>Guardian</option><option>Brother</option><option>Sister</option><option>Uncle</option><option>Other</option>
            </select>
          </div>
          <div className="field"><label>Guardian Phone</label><input type="tel" value={form.parent_phone} onChange={set('parent_phone')} /></div>
          <div className="field"><label>Guardian Email</label><input type="email" value={form.parent_email} onChange={set('parent_email')} /></div>
        </div>
        <div className="field"><label>Address</label><textarea value={form.address} onChange={set('address')} /></div>
        {!editing && (
          <>
            <div className="field row">
              <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.create_login} onChange={set('create_login')} /> Create a student portal login</label>
            </div>
            {form.create_login && (
              <div className="form-grid">
                <div className="field"><label>Username</label><input value={form.username} onChange={set('username')} /></div>
                <div className="field"><label>Password</label><input type="password" value={form.password} onChange={set('password')} /></div>
              </div>
            )}
          </>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Admit Student'}</button>
        </div>
      </form>
    </Modal>
  );
}
