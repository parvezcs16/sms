import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { useAcademicRefs, todayStr } from '../utils/useRefs';
import { textProps } from '../utils/urdu';
import Modal from '../components/Modal';
import WhatsAppShareModal from '../components/WhatsAppShareModal';
import DateInput from '../components/DateInput';

const STATUS_VARIANT = { Pending: 'muted', 'In Progress': 'warning', Completed: 'success' };

export default function HomeworkPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const refs = useAcademicRefs();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'homework';
  const [mySections, setMySections] = useState(null);
  const [progress, setProgress] = useState([]);
  const [reload, setReload] = useState(0);
  const [share, setShare] = useState(null); // request for WhatsAppShareModal
  const [pick, setPick] = useState(null); // { kind, ...choices } before sharing
  const [hwFilter, setHwFilter] = useState({});
  const [syFilter, setSyFilter] = useState({});
  const all = can('homework', 'view');
  const manageAll = can('homework', 'manage');

  useEffect(() => {
    if (!all && user.teacher_id) api.get('/attendance/my-sections').then(setMySections).catch(() => setMySections([]));
  }, [all, user.teacher_id]);
  useEffect(() => { if (tab === 'syllabus') api.get('/homework/syllabus-progress').then(setProgress).catch(() => {}); }, [tab, reload]);

  const sectionOptions = all || !mySections ? refs.sectionOptions : mySections.map((s) => ({ value: String(s.id), label: `${s.class_name} - ${s.section_name}` }));
  const myClassIds = new Set((mySections || []).map((s) => String(refs.sections.find((x) => x.id === s.id)?.class_id)));
  const classOptions = all ? refs.classOptions : refs.classOptions.filter((c) => myClassIds.has(c.value));
  const canAdd = manageAll || Boolean(user.teacher_id);

  async function setStatus(row, status, reloadList) {
    try {
      await api.put(`/homework/syllabus/${row.id}`, { status });
      reloadList();
      setReload((r) => r + 1);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const switchTab = (t) => setParams({ tab: t }, { replace: true });

  return (
    <div>
      <div className="page-header"><h2>Homework &amp; Syllabus</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'homework' ? '' : 'btn-ghost'} onClick={() => switchTab('homework')}>Homework / Diary</button>
        <button type="button" className={tab === 'syllabus' ? '' : 'btn-ghost'} onClick={() => switchTab('syllabus')}>Syllabus Coverage</button>
      </div>

      {tab === 'homework' && (
        <CrudManager
          endpoint="/homework/items"
          noun="homework"
          addLabel="Give Homework"
          canManage={canAdd}
          fields={[
            { key: 'section_id', label: 'Class', type: 'select', options: sectionOptions, required: true },
            { key: 'subject_id', label: 'Subject', type: 'select', options: refs.subjectOptions, required: true },
            { key: 'assigned_on', label: 'Date', type: 'date', required: true, default: todayStr },
            { key: 'due_date', label: 'Due date', type: 'date' },
            { key: 'title', label: 'Homework', required: true, full: true, placeholder: 'e.g. Exercise 3.2, Q1–5' },
            { key: 'details', label: 'Details / instructions', type: 'textarea', full: true }
          ]}
          filters={[
            { key: 'section_id', label: 'All classes', type: 'select', options: sectionOptions },
            { key: 'subject_id', label: 'All subjects', type: 'select', options: refs.subjectOptions },
            { key: 'from', label: 'From', type: 'date' },
            { key: 'to', label: 'To', type: 'date' }
          ]}
          columns={[
            { key: 'assigned_on', label: 'Date' },
            { key: 'class_name', label: 'Class', render: (r) => `${r.class_name} - ${r.section_name}` },
            { key: 'subject_name', label: 'Subject' },
            { key: 'title', label: 'Homework', render: (r) => <div {...textProps(r.title)}><b>{r.title}</b>{r.details && <div className="muted" style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }} dir="auto">{r.details}</div>}</div> },
            { key: 'due_date', label: 'Due', render: (r) => r.due_date || '—' },
            { key: 'created_by_name', label: 'Given by' }
          ]}
          onFilterChange={setHwFilter}
          toolbar={canAdd && <button type="button" className="btn-success" onClick={() => setPick({ kind: 'diary', section_id: hwFilter.section_id || (sectionOptions.length === 1 ? sectionOptions[0].value : ''), date: hwFilter.to && hwFilter.to === hwFilter.from ? hwFilter.to : todayStr() })}>📤 Share Diary on WhatsApp</button>}
          rowActions={(r) => (canAdd ? <IconButton icon="send" tone="success" label="Share on WhatsApp" onClick={() => setShare({ kind: 'homework', homework_id: r.id })} /> : null)}
          toPayload={(b) => ({ ...b, section_id: Number(b.section_id), subject_id: Number(b.subject_id) })}
          emptyMessage="No homework yet. Parents and students see homework in their portal."
          describe={(r) => r.title}
        />
      )}

      {tab === 'syllabus' && (
        <>
          {progress.length > 0 && (
            <div className="card">
              <h3>Coverage</h3>
              <table>
                <thead><tr><th>Class</th><th>Subject</th><th>Topics</th><th>Done</th><th style={{ width: '35%' }}>Progress</th><th>Behind plan</th></tr></thead>
                <tbody>
                  {progress.map((p) => {
                    const pct = Math.round((p.completed / p.topics) * 100);
                    return (
                      <tr key={`${p.class_id}-${p.subject_id}`}>
                        <td>{p.class_name}</td><td>{p.subject_name}</td><td>{p.topics}</td><td>{p.completed}</td>
                        <td><span className="row" style={{ margin: 0, flexWrap: 'nowrap', gap: 8 }}><span className="fin-bar" style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></span><b>{pct}%</b></span></td>
                        <td>{p.behind ? <span style={{ color: 'var(--danger)' }}>{p.behind}</span> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <CrudManager
            endpoint="/homework/syllabus"
            noun="topic"
            addLabel="Add Topic"
            canManage={canAdd}
            reloadKey={reload}
            fields={[
              { key: 'class_id', label: 'Class', type: 'select', options: classOptions, required: true },
              { key: 'subject_id', label: 'Subject', type: 'select', options: refs.subjectOptions, required: true },
              { key: 'term', label: 'Term', placeholder: 'e.g. First Term' },
              { key: 'unit', label: 'Unit / chapter' },
              { key: 'topic', label: 'Topic', required: true, full: true },
              { key: 'planned_from', label: 'Planned from', type: 'date' },
              { key: 'planned_to', label: 'Planned to', type: 'date' },
              { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Completed'], noBlank: true, default: 'Pending' },
              { key: 'notes', label: 'Notes', full: true }
            ]}
            filters={[
              { key: 'class_id', label: 'All classes', type: 'select', options: classOptions },
              { key: 'subject_id', label: 'All subjects', type: 'select', options: refs.subjectOptions },
              { key: 'status', label: 'Any status', type: 'select', options: ['Pending', 'In Progress', 'Completed'] }
            ]}
            columns={[
              { key: 'class_name', label: 'Class' },
              { key: 'subject_name', label: 'Subject' },
              { key: 'unit', label: 'Unit', render: (r) => <span dir="auto">{r.unit || '—'}</span> },
              { key: 'topic', label: 'Topic', render: (r) => <span {...textProps(r.topic)}>{r.topic}</span> },
              { key: 'planned', label: 'Planned', render: (r) => (r.planned_from || r.planned_to ? `${r.planned_from || ''} → ${r.planned_to || ''}` : '—') },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <>
                    <Badge variant={r.status === 'Pending' && r.planned_to && r.planned_to < todayStr() ? 'danger' : STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    {r.completed_on && <div className="muted" style={{ fontSize: '0.72rem' }}>{r.completed_on}</div>}
                  </>
                )
              }
            ]}
            onFilterChange={setSyFilter}
            toolbar={canAdd && <button type="button" className="btn-success" onClick={() => setPick({ kind: 'syllabus', class_id: syFilter.class_id || (classOptions.length === 1 ? classOptions[0].value : ''), subject_id: syFilter.subject_id || '', term: '' })}>📤 Share Syllabus on WhatsApp</button>}
            rowActions={(r, reloadList) => (canAdd && r.status !== 'Completed'
              ? <IconButton icon="check" tone="success" label="Mark completed" onClick={() => setStatus(r, 'Completed', reloadList)} />
              : null)}
            toPayload={(b) => ({ ...b, class_id: Number(b.class_id), subject_id: Number(b.subject_id) })}
            emptyMessage="No syllabus topics yet. Add the chapters / topics you plan to teach and tick them off as you go."
            describe={(r) => r.topic}
          />
        </>
      )}

      {pick && (
        <Modal title={pick.kind === 'diary' ? 'Share the Daily Diary' : 'Share the Syllabus'} onClose={() => setPick(null)}
          footer={<button type="button" className="btn-success" disabled={pick.kind === 'diary' ? !pick.section_id || !pick.date : !pick.class_id}
            onClick={() => { setShare(pick); setPick(null); }}>Next</button>}>
          {pick.kind === 'diary' ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>All homework given to the class on that day goes out as one diary message.</p>
              <div className="field"><label>Class</label>
                <select value={pick.section_id} onChange={(e) => setPick({ ...pick, section_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {sectionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Date</label><DateInput value={pick.date} onChange={(e) => setPick({ ...pick, date: e.target.value })} /></div>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Sends the topic list with what is done and what is coming up — to the parents of every section of the class.</p>
              <div className="field"><label>Class</label>
                <select value={pick.class_id} onChange={(e) => setPick({ ...pick, class_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Subject</label>
                <select value={pick.subject_id} onChange={(e) => setPick({ ...pick, subject_id: e.target.value })}>
                  <option value="">All subjects</option>
                  {refs.subjectOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Term (optional)</label><input value={pick.term} placeholder="e.g. First Term" onChange={(e) => setPick({ ...pick, term: e.target.value })} /></div>
            </>
          )}
        </Modal>
      )}
      {share && <WhatsAppShareModal request={share} onClose={() => setShare(null)} />}
    </div>
  );
}
