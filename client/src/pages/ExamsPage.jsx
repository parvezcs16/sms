import { useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import ShareButtons from '../components/ShareButtons';
import Modal from '../components/Modal';
import IconButton from '../components/IconButton';
import PaperView from '../components/PaperView';
import { printElement } from '../utils/print';
import { hasUrdu, textProps } from '../utils/urdu';
import DateInput from '../components/DateInput';

const QUESTION_TYPES = ['MCQ', 'Short', 'Long', 'FillBlank', 'TrueFalse'];
const TYPE_LABEL = { MCQ: 'MCQ', Short: 'Short', Long: 'Long', FillBlank: 'Fill in the blank', TrueFalse: 'True / False' };
const EMPTY_Q = { subject_id: '', class_id: '', chapter: '', topic: '', difficulty: 'Medium', marks: 1, question_type: 'Short', question_text: '', options: ['', '', '', ''] };
const EMPTY_PAPER = { id: null, title: '', class_id: '', subject_id: '', term: '', scheduled_date: '', duration_minutes: 60, instructions: '', picks: [] };

function langOf(q) { return hasUrdu(q.question_text) ? 'ur' : 'en'; }

export default function ExamsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can('exams', 'manage');
  const [tab, setTab] = useState('bank');
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [papers, setPapers] = useState([]);

  // ---- question bank ----
  const [qForm, setQForm] = useState(EMPTY_Q);
  const [editingQ, setEditingQ] = useState(null);
  const [bankFilter, setBankFilter] = useState({ subject_id: '', class_id: '', chapter: '', lang: '', search: '' });

  // ---- paper builder ----
  const [paper, setPaper] = useState(EMPTY_PAPER);
  const [pickFilter, setPickFilter] = useState({ chapter: '', question_type: '', difficulty: '', lang: '', search: '' });
  const [randomCount, setRandomCount] = useState(5);
  const [preview, setPreview] = useState(null); // { paper, questions, fromBuilder }
  const previewRef = useRef(null);

  async function loadRefs() {
    const [s, c] = await Promise.all([api.get('/academics/subjects'), api.get('/academics/classes')]);
    setSubjects(s); setClasses(c);
  }
  async function loadQuestions() { setQuestions(await api.get('/exams/questions')); }
  async function loadPapers() { setPapers(await api.get('/exams/papers')); }
  useEffect(() => { loadRefs(); loadQuestions(); loadPapers(); }, []);

  const subjectName = (id) => subjects.find((s) => String(s.id) === String(id))?.name || '';
  const className = (id) => classes.find((c) => String(c.id) === String(id))?.name || '';

  // ---------- question bank ----------
  const bankChapters = useMemo(() => [...new Set(questions.filter((q) => !bankFilter.subject_id || String(q.subject_id) === bankFilter.subject_id).map((q) => q.chapter).filter(Boolean))].sort(), [questions, bankFilter.subject_id]);
  const bankList = questions.filter((q) => (!bankFilter.subject_id || String(q.subject_id) === bankFilter.subject_id)
    && (!bankFilter.class_id || String(q.class_id || '') === bankFilter.class_id)
    && (!bankFilter.chapter || q.chapter === bankFilter.chapter)
    && (!bankFilter.lang || langOf(q) === bankFilter.lang)
    && (!bankFilter.search || q.question_text.toLowerCase().includes(bankFilter.search.toLowerCase())));

  function startEditQuestion(q) {
    let options = ['', '', '', ''];
    try { const parsed = q.options_json ? JSON.parse(q.options_json) : null; if (Array.isArray(parsed)) options = [...parsed, '', '', '', ''].slice(0, Math.max(4, parsed.length)); } catch { /* ignore */ }
    setQForm({
      subject_id: String(q.subject_id), class_id: q.class_id ? String(q.class_id) : '', chapter: q.chapter || '', topic: q.topic || '',
      difficulty: q.difficulty || 'Medium', marks: q.marks, question_type: q.question_type, question_text: q.question_text, options
    });
    setEditingQ(q.id);
  }

  function cancelEditQuestion() {
    setEditingQ(null);
    setQForm({ ...qForm, chapter: qForm.chapter, topic: '', question_text: '', options: ['', '', '', ''] });
  }

  async function deleteQuestion(q) {
    if (!window.confirm('Remove this question from the bank? Papers already made keep it.')) return;
    try {
      await api.del(`/exams/questions/${q.id}`);
      if (editingQ === q.id) cancelEditQuestion();
      loadQuestions();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitQuestion(e) {
    e.preventDefault();
    try {
      const payload = { ...qForm, options: qForm.question_type === 'MCQ' ? qForm.options.filter(Boolean) : [] };
      if (editingQ) {
        await api.put(`/exams/questions/${editingQ}`, payload);
        toast.success('Question updated');
        setEditingQ(null);
      } else {
        await api.post('/exams/questions', { ...payload, options: payload.options.length ? payload.options : undefined });
        toast.success('Question added to bank');
      }
      // Keep subject / class / chapter so the next question can be typed straight away.
      setQForm({ ...qForm, topic: '', question_text: '', options: ['', '', '', ''] });
      loadQuestions();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // ---------- paper builder ----------
  const pickedIds = new Set(paper.picks.map((p) => p.id));
  const subjectPool = questions.filter((q) => paper.subject_id && String(q.subject_id) === String(paper.subject_id)
    && (!paper.class_id || !q.class_id || String(q.class_id) === String(paper.class_id)));
  const pickChapters = [...new Set(subjectPool.map((q) => q.chapter).filter(Boolean))].sort();
  const available = subjectPool.filter((q) => !pickedIds.has(q.id)
    && (!pickFilter.chapter || q.chapter === pickFilter.chapter)
    && (!pickFilter.question_type || q.question_type === pickFilter.question_type)
    && (!pickFilter.difficulty || q.difficulty === pickFilter.difficulty)
    && (!pickFilter.lang || langOf(q) === pickFilter.lang)
    && (!pickFilter.search || q.question_text.toLowerCase().includes(pickFilter.search.toLowerCase())));
  const totalMarks = paper.picks.reduce((s, p) => s + Number(p.marks || 0), 0);

  const addPick = (q) => setPaper((p) => ({ ...p, picks: [...p.picks, { ...q, marks: q.marks }] }));
  const addMany = (list) => setPaper((p) => ({ ...p, picks: [...p.picks, ...list.map((q) => ({ ...q, marks: q.marks }))] }));
  const removePick = (id) => setPaper((p) => ({ ...p, picks: p.picks.filter((x) => x.id !== id) }));
  const setPickMarks = (id, marks) => setPaper((p) => ({ ...p, picks: p.picks.map((x) => (x.id === id ? { ...x, marks } : x)) }));
  function movePick(idx, dir) {
    setPaper((p) => {
      const picks = [...p.picks];
      const j = idx + dir;
      if (j < 0 || j >= picks.length) return p;
      [picks[idx], picks[j]] = [picks[j], picks[idx]];
      return { ...p, picks };
    });
  }
  function addRandom() {
    const n = Math.max(1, Number(randomCount) || 1);
    const pool = [...available];
    for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const chosen = pool.slice(0, n);
    if (!chosen.length) return toast.info('No more questions match these filters');
    addMany(chosen);
    if (chosen.length < n) toast.info(`Only ${chosen.length} matching question(s) were available`);
  }

  function builderPaperData() {
    return {
      title: paper.title, term: paper.term, scheduled_date: paper.scheduled_date, duration_minutes: paper.duration_minutes, instructions: paper.instructions,
      class_name: className(paper.class_id), subject_name: subjectName(paper.subject_id)
    };
  }

  async function savePaper() {
    if (!paper.title.trim()) return toast.error('Please give the paper a title');
    if (!paper.subject_id) return toast.error('Please select the subject');
    if (!paper.picks.length) return toast.error('Select at least one question');
    if (paper.picks.some((p) => !(Number(p.marks) > 0))) return toast.error('Every question needs marks more than 0');
    const body = {
      title: paper.title, class_id: paper.class_id || null, subject_id: paper.subject_id, term: paper.term, scheduled_date: paper.scheduled_date || null,
      duration_minutes: Number(paper.duration_minutes) || 60, instructions: paper.instructions,
      questions: paper.picks.map((p) => ({ id: p.id, marks: Number(p.marks) }))
    };
    try {
      const res = paper.id ? await api.put(`/exams/papers/${paper.id}`, body) : await api.post('/exams/papers', body);
      toast.success(`Paper saved — ${res.question_count} questions, ${res.total_marks} marks`);
      setPaper(EMPTY_PAPER);
      setPreview(null);
      loadPapers();
      setTab('papers');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function openSaved(p, mode) {
    try {
      const data = await api.get(`/exams/papers/${p.id}`);
      if (mode === 'edit') {
        setPaper({
          id: data.id, title: data.title || '', class_id: data.class_id ? String(data.class_id) : '', subject_id: String(data.subject_id || ''),
          term: data.term || '', scheduled_date: data.scheduled_date || '', duration_minutes: data.duration_minutes || 60, instructions: data.instructions || '',
          picks: data.questions.map((q) => ({ ...q, marks: q.marks_override || q.marks }))
        });
        setTab('build');
      } else {
        setPreview({ paper: data, questions: data.questions, fromBuilder: false });
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deletePaper(p) {
    if (!window.confirm(`Delete the paper "${p.title}"? The questions stay in the bank.`)) return;
    try {
      await api.del(`/exams/papers/${p.id}`);
      loadPapers();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const tp = (t) => textProps(t);

  return (
    <div>
      <div className="page-header"><h2>Examinations</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'bank' ? '' : 'btn-ghost'} onClick={() => setTab('bank')}>Question Bank</button>
        {canManage && <button type="button" className={tab === 'build' ? '' : 'btn-ghost'} onClick={() => setTab('build')}>{paper.id ? 'Edit Paper' : 'Make a Paper'}</button>}
        <button type="button" className={tab === 'papers' ? '' : 'btn-ghost'} onClick={() => setTab('papers')}>Exam Papers ({papers.length})</button>
      </div>

      {tab === 'bank' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Question Bank ({bankList.length}{bankList.length !== questions.length ? ` of ${questions.length}` : ''})</h3>
            <div className="row filters" style={{ marginBottom: 10 }}>
              <select value={bankFilter.subject_id} onChange={(e) => setBankFilter({ ...bankFilter, subject_id: e.target.value, chapter: '' })}>
                <option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={bankFilter.class_id} onChange={(e) => setBankFilter({ ...bankFilter, class_id: e.target.value })}>
                <option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={bankFilter.chapter} onChange={(e) => setBankFilter({ ...bankFilter, chapter: e.target.value })}>
                <option value="">All chapters</option>{bankChapters.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={bankFilter.lang} onChange={(e) => setBankFilter({ ...bankFilter, lang: e.target.value })}>
                <option value="">English &amp; Urdu</option><option value="en">English</option><option value="ur">اردو Urdu</option>
              </select>
              <input placeholder="Search…" dir="auto" value={bankFilter.search} onChange={(e) => setBankFilter({ ...bankFilter, search: e.target.value })} />
            </div>
            <div className="stack" style={{ maxHeight: 520, overflowY: 'auto' }}>
              {bankList.map((q) => (
                <div key={q.id} className="card" style={{ marginBottom: 0, ...(editingQ === q.id ? { borderColor: 'var(--accent)' } : {}) }}>
                  <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                    <span><b>{q.subject_name}</b> <span className="muted">{q.class_name ? `${q.class_name} · ` : ''}{q.chapter ? `${q.chapter} · ` : ''}{q.difficulty} · {q.marks} marks · {TYPE_LABEL[q.question_type] || q.question_type}</span></span>
                    {canManage && (
                      <span className="actions-cell">
                        <IconButton icon="edit" tone="primary" label="Edit" onClick={() => startEditQuestion(q)} />
                        <IconButton icon="trash" tone="danger" label="Remove" onClick={() => deleteQuestion(q)} />
                      </span>
                    )}
                  </div>
                  <p style={{ marginTop: 6, marginBottom: 0 }} {...tp(q.question_text)}>{q.question_text}</p>
                </div>
              ))}
              {bankList.length === 0 && <p className="muted">{questions.length ? 'No questions match these filters.' : 'No questions yet — add one on the right.'}</p>}
            </div>
          </div>
          {canManage && (
            <div className="card">
              <h3>{editingQ ? 'Edit Question' : 'Add Question'}</h3>
              <form onSubmit={submitQuestion}>
                <div className="form-grid">
                  <div className="field"><label>Subject</label>
                    <select required value={qForm.subject_id} onChange={(e) => setQForm({ ...qForm, subject_id: e.target.value })}>
                      <option value="">Select</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Class</label>
                    <select value={qForm.class_id} onChange={(e) => setQForm({ ...qForm, class_id: e.target.value })}>
                      <option value="">Any</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Chapter</label><input dir="auto" list="chapter-list" value={qForm.chapter} onChange={(e) => setQForm({ ...qForm, chapter: e.target.value })} /></div>
                  <div className="field"><label>Topic</label><input dir="auto" value={qForm.topic} onChange={(e) => setQForm({ ...qForm, topic: e.target.value })} /></div>
                  <div className="field"><label>Difficulty</label>
                    <select value={qForm.difficulty} onChange={(e) => setQForm({ ...qForm, difficulty: e.target.value })}>
                      <option>Easy</option><option>Medium</option><option>Hard</option>
                    </select>
                  </div>
                  <div className="field"><label>Marks</label><input type="number" min="1" value={qForm.marks} onChange={(e) => setQForm({ ...qForm, marks: Number(e.target.value) })} /></div>
                  <div className="field"><label>Question Type</label>
                    <select value={qForm.question_type} onChange={(e) => setQForm({ ...qForm, question_type: e.target.value })}>
                      {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                  </div>
                </div>
                <datalist id="chapter-list">{[...new Set(questions.filter((q) => !qForm.subject_id || String(q.subject_id) === qForm.subject_id).map((q) => q.chapter).filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
                <div className="field">
                  <label>Question Text <span className="muted" style={{ fontWeight: 400 }}>— English or اردو (Urdu writes right-to-left automatically)</span></label>
                  <textarea required dir="auto" {...(hasUrdu(qForm.question_text) ? { className: 'urdu-input' } : {})} value={qForm.question_text} onChange={(e) => setQForm({ ...qForm, question_text: e.target.value })} />
                </div>
                {qForm.question_type === 'MCQ' && (
                  <div className="field">
                    <label>Options</label>
                    {qForm.options.map((opt, i) => (
                      <input key={i} dir="auto" className={hasUrdu(opt) ? 'urdu-input' : undefined} style={{ marginTop: 6 }} value={opt} placeholder={`Option ${i + 1}`} onChange={(e) => {
                        const options = [...qForm.options]; options[i] = e.target.value; setQForm({ ...qForm, options });
                      }} />
                    ))}
                  </div>
                )}
                <p className="muted" style={{ fontSize: '0.78rem', marginTop: 0 }}>To type Urdu, add the Urdu keyboard in Windows Settings → Time &amp; Language → Language, then switch with <b>Win + Space</b>.</p>
                <div className="row">
                  <button type="submit">{editingQ ? 'Save Changes' : 'Add to Question Bank'}</button>
                  {editingQ && <button type="button" className="btn-ghost" onClick={cancelEditQuestion}>Cancel Edit</button>}
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {tab === 'build' && canManage && (
        <div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
              <h3 style={{ margin: 0 }}>{paper.id ? 'Edit Paper' : 'Make a Paper'} — step 1: paper details</h3>
              {paper.id && <button type="button" className="btn-ghost btn-sm" onClick={() => setPaper(EMPTY_PAPER)}>Start a new paper instead</button>}
            </div>
            <form className="form-grid" style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 14px' }} onSubmit={(e) => e.preventDefault()}>
              <div className="field"><label>Title</label><input dir="auto" required value={paper.title} placeholder="e.g. Monthly Test — November" onChange={(e) => setPaper({ ...paper, title: e.target.value })} /></div>
              <div className="field"><label>Subject</label>
                <select required value={paper.subject_id} onChange={(e) => {
                  if (paper.picks.length && !window.confirm('Changing the subject clears the questions picked so far. Continue?')) return;
                  setPaper({ ...paper, subject_id: e.target.value, picks: [] });
                }}>
                  <option value="">Select subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Class</label>
                <select value={paper.class_id} onChange={(e) => setPaper({ ...paper, class_id: e.target.value })}>
                  <option value="">Any</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Term</label><input value={paper.term} onChange={(e) => setPaper({ ...paper, term: e.target.value })} placeholder="e.g. Midterm" /></div>
              <div className="field"><label>Exam Date</label><DateInput value={paper.scheduled_date} onChange={(e) => setPaper({ ...paper, scheduled_date: e.target.value })} /></div>
              <div className="field"><label>Duration (minutes)</label><input type="number" min="5" value={paper.duration_minutes} onChange={(e) => setPaper({ ...paper, duration_minutes: e.target.value })} /></div>
            </form>
            <div className="field"><label>Instructions</label><textarea dir="auto" rows={2} value={paper.instructions} onChange={(e) => setPaper({ ...paper, instructions: e.target.value })} /></div>
          </div>

          {!paper.subject_id ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Select the subject above to see its questions.</p></div>
          ) : (
            <div className="grid two-col">
              <div className="card">
                <h3>Step 2: choose questions <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>({available.length} available)</span></h3>
                <div className="row filters" style={{ marginBottom: 8 }}>
                  <select value={pickFilter.chapter} onChange={(e) => setPickFilter({ ...pickFilter, chapter: e.target.value })}>
                    <option value="">All chapters</option>{pickChapters.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <select value={pickFilter.question_type} onChange={(e) => setPickFilter({ ...pickFilter, question_type: e.target.value })}>
                    <option value="">All types</option>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                  <select value={pickFilter.difficulty} onChange={(e) => setPickFilter({ ...pickFilter, difficulty: e.target.value })}>
                    <option value="">Any difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option>
                  </select>
                  <select value={pickFilter.lang} onChange={(e) => setPickFilter({ ...pickFilter, lang: e.target.value })}>
                    <option value="">English &amp; Urdu</option><option value="en">English</option><option value="ur">اردو Urdu</option>
                  </select>
                  <input dir="auto" placeholder="Search…" value={pickFilter.search} onChange={(e) => setPickFilter({ ...pickFilter, search: e.target.value })} />
                </div>
                <div className="row filters" style={{ marginBottom: 8 }}>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Quick pick:</span>
                  <input type="number" min="1" style={{ maxWidth: 70 }} value={randomCount} onChange={(e) => setRandomCount(e.target.value)} />
                  <button type="button" className="btn-ghost btn-sm" onClick={addRandom}>Add random from these</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={!available.length} onClick={() => addMany(available)}>Add all shown ({available.length})</button>
                </div>
                <div className="stack" style={{ maxHeight: 460, overflowY: 'auto', gap: 6 }}>
                  {available.map((q) => (
                    <div key={q.id} className="pick-row" onClick={() => addPick(q)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') addPick(q); }} title="Click to add to the paper">
                      <span className="pick-add">＋</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div {...tp(q.question_text)}>{q.question_text}</div>
                        <span className="muted" style={{ fontSize: '0.75rem' }}>{q.chapter || 'No chapter'} · {TYPE_LABEL[q.question_type] || q.question_type} · {q.difficulty} · {q.marks} marks</span>
                      </div>
                    </div>
                  ))}
                  {available.length === 0 && <p className="muted">{subjectPool.length ? 'All matching questions are already on the paper.' : 'No questions for this subject/class yet — add some in the Question Bank.'}</p>}
                </div>
              </div>

              <div className="card">
                <h3>Step 3: on the paper — {paper.picks.length} question{paper.picks.length === 1 ? '' : 's'}, <span style={{ color: 'var(--accent)' }}>{totalMarks} marks</span></h3>
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>Only these questions go on the paper. Change the marks for any question, and use ↑ ↓ to set the order.</p>
                <div className="stack" style={{ maxHeight: 420, overflowY: 'auto', gap: 6 }}>
                  {paper.picks.map((q, i) => (
                    <div key={q.id} className="pick-row picked">
                      <b style={{ minWidth: 26 }}>{i + 1}.</b>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div {...tp(q.question_text)}>{q.question_text}</div>
                        <span className="muted" style={{ fontSize: '0.75rem' }}>{q.chapter || 'No chapter'} · {TYPE_LABEL[q.question_type] || q.question_type}</span>
                      </div>
                      <label className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>Marks
                        <input type="number" min="0.5" step="0.5" style={{ width: 64, display: 'block' }} value={q.marks} onChange={(e) => setPickMarks(q.id, e.target.value)} />
                      </label>
                      <div className="stack" style={{ gap: 2 }}>
                        <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => movePick(i, -1)} aria-label="Move up">↑</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={i === paper.picks.length - 1} onClick={() => movePick(i, 1)} aria-label="Move down">↓</button>
                      </div>
                      <IconButton icon="trash" tone="danger" label="Remove from paper" onClick={() => removePick(q.id)} />
                    </div>
                  ))}
                  {paper.picks.length === 0 && <p className="muted">Click questions on the left to add them.</p>}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn-secondary" disabled={!paper.picks.length} onClick={() => setPreview({ paper: builderPaperData(), questions: paper.picks.map((p) => ({ ...p, marks_override: Number(p.marks) })), fromBuilder: true })}>Preview Paper</button>
                  <button type="button" disabled={!paper.picks.length} onClick={savePaper}>{paper.id ? 'Save Changes' : 'Save Paper'}</button>
                  {paper.picks.length > 0 && <button type="button" className="btn-ghost" onClick={() => window.confirm('Remove all questions from this paper?') && setPaper({ ...paper, picks: [] })}>Clear</button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'papers' && (
        <div className="card">
          <h3>Exam Papers</h3>
          <table>
            <thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Marks</th><th>Questions</th><th>Date</th><th /></tr></thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td {...tp(p.title)}>{p.title}</td><td>{p.class_name || 'Any'}</td><td>{p.subject_name}</td><td>{p.total_marks}</td><td>{p.question_count}</td><td>{p.scheduled_date || '—'}</td>
                  <td><div className="actions-cell">
                    <IconButton icon="view" tone="primary" label="Preview / Print" onClick={() => openSaved(p, 'view')} />
                    <ShareButtons iconOnly path={`/exams/papers/${p.id}/pdf`} filenameBase={`exam-${p.id}`} />
                    <button type="button" className="btn-ghost btn-sm" onClick={() => downloadFile(`/exams/papers/${p.id}/docx`, `exam-${p.id}.docx`)}>Word</button>
                    {canManage && <IconButton icon="edit" tone="primary" label="Edit questions" onClick={() => openSaved(p, 'edit')} />}
                    {canManage && <IconButton icon="trash" tone="danger" label="Delete paper" onClick={() => deletePaper(p)} />}
                  </div></td>
                </tr>
              ))}
              {papers.length === 0 && <tr><td colSpan={7} className="muted">No papers yet — use “Make a Paper”.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal title="Paper Preview" onClose={() => setPreview(null)} wide>
          <div className="paper-preview-frame"><PaperView ref={previewRef} paper={preview.paper} questions={preview.questions} /></div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>{preview.fromBuilder ? 'Back to editing' : 'Close'}</button>
            <button type="button" className="btn-secondary" onClick={() => printElement(previewRef.current, preview.paper.title)}>Print</button>
            {preview.fromBuilder && <button type="button" onClick={savePaper}>{paper.id ? 'Save Changes' : 'Save Paper'}</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}
