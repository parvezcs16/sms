import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import { RecordForm } from '../components/CrudManager';
import { todayStr } from '../utils/useRefs';

const KIND_COLOR = { Holiday: '#dc2626', Exam: '#7c3aed', Meeting: '#0891b2', PTM: '#d97706', Sports: '#16a34a', Event: '#2563eb', Other: '#64748b' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function EventsPage() {
  const toast = useToast();
  const [meta, setMeta] = useState({ kinds: [], audiences: [], can_manage: false });
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [form, setForm] = useState(null);
  const [tick, setTick] = useState(0);

  const first = new Date(month);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const from = ymd(days[0]);
  const to = ymd(days[41]);

  useEffect(() => { api.get('/events/meta').then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    api.get(`/events/items?from=${from}&to=${to}`).then(setEvents).catch((e) => toast.error(e.message));
    api.get('/events/upcoming?limit=12').then(setUpcoming).catch(() => {});
  }, [from, to, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDay = (ds) => events.filter((e) => e.start_date <= ds && (e.end_date || e.start_date) >= ds);

  const fields = [
    { key: 'title', label: 'Title', required: true, full: true },
    { key: 'kind', label: 'Type', type: 'select', options: meta.kinds, noBlank: true },
    { key: 'audience', label: 'Shown to', type: 'select', options: meta.audiences, noBlank: true },
    { key: 'start_date', label: 'Date', type: 'date', required: true },
    { key: 'end_date', label: 'Until (for several days)', type: 'date' },
    { key: 'start_time', label: 'Time', type: 'time' },
    { key: 'description', label: 'Details', type: 'textarea', full: true }
  ];

  async function save(e) {
    e.preventDefault();
    const { id, ...rest } = form;
    const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === '' ? null : v]));
    try {
      if (id) await api.put(`/events/items/${id}`, body); else await api.post('/events/items', body);
      toast.success('Saved to the calendar');
      setForm(null);
      setTick((t) => t + 1);
    } catch (err) { toast.error(err.message); }
  }
  async function remove() {
    if (!window.confirm(`Remove "${form.title}" from the calendar?`)) return;
    try { await api.del(`/events/items/${form.id}`); setForm(null); setTick((t) => t + 1); } catch (err) { toast.error(err.message); }
  }
  const openNew = (date) => meta.can_manage && setForm({ title: '', kind: 'Event', audience: 'All', start_date: date || todayStr(), end_date: '', start_time: '', description: '' });
  const openEvent = (ev) => setForm({ id: ev.id, ...Object.fromEntries(fields.map((f) => [f.key, ev[f.key] ?? ''])), readOnly: !meta.can_manage });

  const today = todayStr();
  return (
    <div>
      <div className="page-header">
        <h2>Events &amp; Calendar</h2>
        {meta.can_manage && <button type="button" onClick={() => openNew()}>+ Add Event / Holiday</button>}
      </div>
      <div className="grid two-col" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(240px, 1fr)', alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 10px' }}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹ Prev</button>
            <h3 style={{ margin: 0 }}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
            <div className="row" style={{ margin: 0 }}>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next ›</button>
            </div>
          </div>
          <div className="cal-grid">
            {DAYS.map((d) => <div key={d} className="cal-head">{d}</div>)}
            {days.map((d) => {
              const ds = ymd(d);
              const list = onDay(ds);
              const out = d.getMonth() !== month.getMonth();
              return (
                <div key={ds} className={`cal-day${out ? ' out' : ''}${ds === today ? ' today' : ''}${d.getDay() === 0 ? ' sun' : ''}`} onDoubleClick={() => openNew(ds)}>
                  <span className="cal-num">{d.getDate()}</span>
                  {list.slice(0, 3).map((ev) => (
                    <button key={ev.id} type="button" className="cal-ev" style={{ background: KIND_COLOR[ev.kind] || KIND_COLOR.Other }} title={`${ev.kind}: ${ev.title}`} onClick={() => openEvent(ev)}>{ev.title}</button>
                  ))}
                  {list.length > 3 && <span className="muted" style={{ fontSize: '0.7rem' }}>+{list.length - 3} more</span>}
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 10, gap: 12 }}>
            {Object.entries(KIND_COLOR).map(([k, c]) => <span key={k} className="row" style={{ margin: 0, gap: 4, fontSize: '0.78rem' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />{k}</span>)}
            {meta.can_manage && <span className="muted" style={{ fontSize: '0.78rem' }}>Double-click a day to add.</span>}
          </div>
        </div>
        <div className="card">
          <h3>Coming up</h3>
          <div className="stack" style={{ gap: 8 }}>
            {upcoming.map((ev) => (
              <div key={ev.id} className="row-selectable" style={{ borderLeft: `4px solid ${KIND_COLOR[ev.kind] || KIND_COLOR.Other}`, paddingLeft: 8, cursor: 'pointer' }} onClick={() => openEvent(ev)}>
                <b dir="auto">{ev.title}</b>
                <div className="muted" style={{ fontSize: '0.78rem' }}>{ev.start_date}{ev.end_date && ev.end_date !== ev.start_date ? ` → ${ev.end_date}` : ''}{ev.start_time ? ` · ${ev.start_time}` : ''} · {ev.kind}</div>
              </div>
            ))}
            {upcoming.length === 0 && <p className="muted">Nothing scheduled.</p>}
          </div>
        </div>
      </div>

      {form && (
        <Modal title={form.readOnly ? form.title : form.id ? 'Edit Event' : 'Add to Calendar'} onClose={() => setForm(null)}>
          {form.readOnly ? (
            <>
              <p><b>{form.kind}</b> · {form.start_date}{form.end_date ? ` → ${form.end_date}` : ''}{form.start_time ? ` · ${form.start_time}` : ''}</p>
              {form.description && <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{form.description}</p>}
              <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setForm(null)}>Close</button></div>
            </>
          ) : (
            <form onSubmit={save}>
              <RecordForm fields={fields} form={form} setForm={setForm} />
              <div className="modal-footer">
                {form.id && <button type="button" className="btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>Remove</button>}
                <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit">Save</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
