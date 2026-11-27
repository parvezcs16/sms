import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import CrudManager from '../components/CrudManager';
import ShareButtons from '../components/ShareButtons';
import { useAcademicRefs } from '../utils/useRefs';

const dayName = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

export default function DateSheetPage() {
  const { can } = useAuth();
  const refs = useAcademicRefs();
  const [terms, setTerms] = useState([]);
  const [filter, setFilter] = useState({ term_id: '', class_id: '' });
  const canManage = can('results', 'manage') || can('exams', 'manage');

  useEffect(() => { api.get('/results/meta').then((m) => setTerms(m.terms)).catch(() => {}); }, []);
  const termOptions = terms.map((t) => ({ value: String(t.id), label: t.name }));
  const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');

  return (
    <div>
      <div className="page-header">
        <h2>Date Sheet</h2>
        <ShareButtons path={`/datesheet/print.pdf${q ? `?${q}` : ''}`} filenameBase="date-sheet" />
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Plan which paper each class sits on which day. Print or share one page per class; parents also see upcoming papers in their portal.</p>
      <CrudManager
        endpoint="/datesheet/entries"
        noun="paper"
        addLabel="Add Paper"
        canManage={canManage}
        fields={[
          { key: 'term_id', label: 'Exam', type: 'select', options: termOptions, blankLabel: '— none —', default: () => filter.term_id },
          { key: 'class_id', label: 'Class', type: 'select', options: refs.classOptions, required: true, default: () => filter.class_id },
          { key: 'subject_id', label: 'Subject', type: 'select', options: refs.subjectOptions, required: true },
          { key: 'exam_date', label: 'Date', type: 'date', required: true },
          { key: 'start_time', label: 'Starts', type: 'time', default: '09:00' },
          { key: 'end_time', label: 'Ends', type: 'time', default: '12:00' },
          { key: 'room', label: 'Room / hall' },
          { key: 'invigilator', label: 'Invigilator' },
          { key: 'notes', label: 'Notes (printed)', full: true, placeholder: 'e.g. Bring geometry box' }
        ]}
        filters={[
          { key: 'term_id', label: 'All exams', type: 'select', options: termOptions },
          { key: 'class_id', label: 'All classes', type: 'select', options: refs.classOptions }
        ]}
        onFilterChange={setFilter}
        columns={[
          { key: 'exam_date', label: 'Date', render: (r) => <><b>{r.exam_date}</b> <span className="muted">{dayName(r.exam_date)}</span></> },
          { key: 'class_name', label: 'Class' },
          { key: 'subject_name', label: 'Subject' },
          { key: 'time', label: 'Time', render: (r) => (r.start_time ? `${r.start_time}${r.end_time ? ` – ${r.end_time}` : ''}` : '—') },
          { key: 'room', label: 'Room' },
          { key: 'invigilator', label: 'Invigilator' },
          { key: 'term_name', label: 'Exam' }
        ]}
        toPayload={(b) => ({ ...b, term_id: b.term_id ? Number(b.term_id) : null, class_id: Number(b.class_id), subject_id: Number(b.subject_id) })}
        emptyMessage="No papers scheduled yet."
        describe={(r) => `${r.class_name} ${r.subject_name} ${r.exam_date}`}
      />
    </div>
  );
}
