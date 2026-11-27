import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ShareButtons from './ShareButtons';

// Approved result cards and this month's progress report, for a parent or student.
export default function ChildResults({ studentId, code }) {
  const [terms, setTerms] = useState([]);
  useEffect(() => { api.get(`/results/students/${studentId}/terms`).then(setTerms).catch(() => setTerms([])); }, [studentId]);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const from = `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
  const to = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}`;
  const label = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return (
    <>
      <h4>Results &amp; Progress</h4>
      <div className="row" style={{ margin: '0 0 6px' }}>
        <span>Progress report — {label}</span>
        <ShareButtons path={`/results/students/${studentId}/progress.pdf?from=${from}&to=${to}&label=${encodeURIComponent(label)}`} filenameBase={`progress-${code}`} />
      </div>
      {terms.map((t) => (
        <div key={t.id} className="row" style={{ margin: '0 0 6px' }}>
          <span>Result card — {t.name}</span>
          <ShareButtons path={`/results/terms/${t.id}/students/${studentId}/card.pdf`} filenameBase={`result-${code}-${t.id}`} />
        </div>
      ))}
      {terms.length === 0 && <p className="muted" style={{ margin: 0 }}>No published result cards yet.</p>}
    </>
  );
}
