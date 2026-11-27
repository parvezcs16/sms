import { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import PhotoInput from './PhotoInput';
import DateInput from './DateInput';

const blank = {
  full_name: '', father_name: '', gender: '', date_of_birth: '', email: '', phone: '', address: '', qualification: '', designation: '',
  employment_type: 'Full-time', hire_date: '', status: 'Active', create_login: false, username: '', password: ''
};

function fromTeacher(t) {
  const out = { ...blank };
  Object.keys(blank).forEach((k) => { if (t[k] !== undefined && t[k] !== null) out[k] = t[k]; });
  out.create_login = false;
  return out;
}

export default function TeacherFormModal({ teacher, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(teacher);
  const [form, setForm] = useState(() => (editing ? fromTeacher(teacher) : blank));
  const [photo, setPhoto] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(teacher?.photo_path || null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function removePhoto() {
    if (!editing || !window.confirm('Remove this teacher\'s photo?')) return;
    try {
      await api.del(`/teachers/${teacher.id}/photo`);
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
      let id = teacher?.id;
      if (editing) {
        const { create_login, username, password, ...fields } = form; // eslint-disable-line no-unused-vars
        if (teacher.status === 'Relieved') delete fields.status;
        await api.put(`/teachers/${id}`, fields);
      } else {
        id = (await api.post('/teachers', form)).id;
      }
      if (photo) {
        const fd = new FormData();
        fd.append('photo', photo);
        try {
          await api.upload(`/teachers/${id}/photo`, fd);
        } catch (err) {
          toast.error(`Teacher saved, but the photo failed to upload: ${err.message}`);
        }
      }
      toast.success(editing ? 'Teacher details updated' : 'Teacher added');
      onSaved(id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? `Edit Teacher — ${teacher.full_name}` : 'Add Teacher'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <PhotoInput label="Teacher Photo" currentPhoto={currentPhoto} file={photo} onChange={setPhoto} onRemove={removePhoto} />
        <div className="form-grid">
          <div className="field"><label>Full Name *</label><input required value={form.full_name} onChange={set('full_name')} /></div>
          <div className="field"><label>Father Name</label><input value={form.father_name} onChange={set('father_name')} /></div>
          <div className="field"><label>Gender</label>
            <select value={form.gender} onChange={set('gender')}>
              <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <div className="field"><label>Date of Birth</label><DateInput value={form.date_of_birth} onChange={set('date_of_birth')} /></div>
          <div className="field"><label>Phone</label><input type="tel" value={form.phone} onChange={set('phone')} /></div>
          <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          <div className="field"><label>Designation</label><input value={form.designation} onChange={set('designation')} /></div>
          <div className="field"><label>Qualification</label><input value={form.qualification} onChange={set('qualification')} /></div>
          <div className="field"><label>Employment Type</label>
            <select value={form.employment_type} onChange={set('employment_type')}>
              <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Visiting</option>
            </select>
          </div>
          <div className="field"><label>Joining Date</label><DateInput value={form.hire_date} onChange={set('hire_date')} /></div>
          {editing && teacher.status !== 'Relieved' && (
            <div className="field"><label>Status</label>
              <select value={form.status} onChange={set('status')}>
                <option>Active</option><option>Inactive</option><option>On Leave</option>
              </select>
              <span className="muted" style={{ fontSize: '0.75rem' }}>Leaving the school? Use Relieve so the date and salary history are kept.</span>
            </div>
          )}
        </div>
        <div className="field"><label>Address</label><textarea value={form.address} onChange={set('address')} /></div>
        {!editing && (
          <>
            <div className="field row">
              <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.create_login} onChange={set('create_login')} /> Create a teacher login (needed to mark attendance)</label>
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
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Teacher'}</button>
        </div>
      </form>
    </Modal>
  );
}
