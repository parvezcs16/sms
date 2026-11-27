import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const KIND_COLOR = { Holiday: '#dc2626', Exam: '#7c3aed', Meeting: '#0891b2', PTM: '#d97706', Sports: '#16a34a', Event: '#2563eb', Other: '#64748b' };

// "Coming up": calendar events for everyone; for parents, students and
// teachers also recent homework and upcoming exam papers.
export default function UpcomingPanel() {
  const { user } = useAuth();
  const family = ['parent', 'student'].includes(user.role);
  const [events, setEvents] = useState([]);
  const [homework, setHomework] = useState([]);
  const [papers, setPapers] = useState([]);

  useEffect(() => {
    api.get('/events/upcoming?limit=5').then(setEvents).catch(() => {});
    if (family || user.teacher_id) api.get('/homework/my').then((h) => setHomework(h.slice(0, family ? 8 : 5))).catch(() => {});
    if (family) api.get('/datesheet/my').then((p) => setPapers(p.slice(0, 8))).catch(() => {});
  }, [family, user.teacher_id]);

  if (!events.length && !homework.length && !papers.length) return null;
  return (
    <div className="grid two-col" style={{ marginBottom: 16 }}>
      {events.length > 0 && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}><h3 style={{ margin: 0 }}>Coming up</h3><Link to="/events">Calendar →</Link></div>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {events.map((e) => (
              <div key={e.id} style={{ borderLeft: `4px solid ${KIND_COLOR[e.kind] || KIND_COLOR.Other}`, paddingLeft: 8 }}>
                <b dir="auto">{e.title}</b>
                <div className="muted" style={{ fontSize: '0.78rem' }}>{e.start_date}{e.end_date && e.end_date !== e.start_date ? ` → ${e.end_date}` : ''}{e.start_time ? ` · ${e.start_time}` : ''} · {e.kind}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {homework.length > 0 && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}><h3 style={{ margin: 0 }}>Homework</h3>{!family && <Link to="/homework">All homework →</Link>}</div>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {homework.map((h) => (
              <div key={h.id}>
                <b dir="auto">{h.subject_name}: {h.title}</b>
                <div className="muted" style={{ fontSize: '0.78rem' }}>{h.class_name} - {h.section_name} · {h.assigned_on}{h.due_date ? ` · due ${h.due_date}` : ''}</div>
                {family && h.details && <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }} dir="auto">{h.details}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {papers.length > 0 && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginTop: 0 }}>Exam date sheet</h3>
          <table>
            <thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Time</th></tr></thead>
            <tbody>
              {papers.map((p) => <tr key={p.id}><td>{p.exam_date}</td><td>{p.class_name}</td><td>{p.subject_name}</td><td>{p.start_time || ''}{p.end_time ? ` – ${p.end_time}` : ''}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
