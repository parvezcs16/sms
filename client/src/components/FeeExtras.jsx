import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import ShareButtons from './ShareButtons';
import { PAYMENT_MODES, needsReference, referenceLabel } from '../utils/payment';
import { localDateStr } from '../utils/date';
import DateInput from './DateInput';

const money = (n) => Number(n || 0).toFixed(2);

// Bulk voucher printing — 2 per A4 page, optionally one combined voucher per family.
export function PrintVouchersModal({ classes, sections, periods, onClose, selectedIds = [] }) {
  const picked = selectedIds.length > 0;
  const [f, setF] = useState({ period_label: picked ? '' : (periods[0] || ''), class_id: '', section_id: '', family: false, unpaid: !picked, per_page: '2' });
  function go(e) {
    e.preventDefault();
    const q = new URLSearchParams({ period_label: f.period_label, class_id: f.class_id, section_id: f.section_id, family: f.family ? '1' : '', unpaid: f.unpaid ? '1' : '0', per_page: f.per_page });
    if (picked) q.set('ids', selectedIds.join(','));
    downloadFile(`/fees/vouchers.pdf?${q}`, `fee-vouchers-${(f.period_label || 'all').replace(/\s+/g, '-')}.pdf`);
    onClose();
  }
  return (
    <Modal title={picked ? `Print ${selectedIds.length} selected voucher(s)` : 'Print Fee Vouchers'} onClose={onClose}>
      <form onSubmit={go}>
        <div className="field"><label>Vouchers on one A4 page</label>
          <div className="seg">
            {[['1', '1 (full page)'], ['2', '2 per page'], ['3', '3 per page (compact)']].map(([k, label]) => (
              <button key={k} type="button" className={f.per_page === k ? 'active' : ''} onClick={() => setF({ ...f, per_page: k })}>{label}</button>
            ))}
          </div>
        </div>
        {!picked && <>
        <div className="field"><label>Fee month</label>
          <input list="voucher-periods" value={f.period_label} onChange={(e) => setF({ ...f, period_label: e.target.value })} placeholder="All months" />
          <datalist id="voucher-periods">{periods.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="form-grid">
          <div className="field"><label>Class</label>
            <select value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value, section_id: '' })}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
          <div className="field"><label>Section</label>
            <select value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })}><option value="">Whole class</option>
              {sections.filter((s) => !f.class_id || String(s.class_id) === String(f.class_id)).map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
            </select>
          </div>
        </div>
        <label className="row" style={{ margin: '4px 0' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.family} onChange={(e) => setF({ ...f, family: e.target.checked })} /> One combined voucher per family (brothers &amp; sisters together)</label>
        <label className="row" style={{ margin: '4px 0' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.unpaid} onChange={(e) => setF({ ...f, unpaid: e.target.checked })} /> Only unpaid vouchers</label>
        </>}
        {picked && <p className="muted">Only the vouchers you ticked on the Invoices list are printed, one after another.</p>}
        <p className="muted" style={{ fontSize: '0.8rem' }}>Vouchers are printed one after another with a cut line between them. Each voucher shows the fee month under the school name, and any earlier unpaid dues as <b>Arrears</b>.</p>
        <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit">Print Vouchers</button></div>
      </form>
    </Modal>
  );
}

// Pay several dues at once (arrears first) — for one student or a whole family.
export function PayDuesModal({ title, endpoint, owed, invoices, onClose, onDone, receivedBy, allowAdvance = false }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: String(owed || ''), discount: '', payment_method: 'Cash', payment_reference: '', notes: '', payment_date: localDateStr() });
  const [saving, setSaving] = useState(false);
  const extra = Math.round((Number(f.amount || 0) + Number(f.discount || 0) - owed) * 100) / 100;
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post(endpoint, { ...f, amount: Number(f.amount || 0), discount: Number(f.discount || 0), keep_extra_as_advance: allowAdvance });
      toast.success(`Received ${money(f.amount)} — ${res.payments.length} voucher(s) updated${res.remaining > 0 ? `, ${money(res.remaining)} still due` : ''}${res.advance > 0 ? `, ${money(res.advance)} kept as advance` : ''}`);
      if (res.payments.length) downloadFile(`/fees/receipts/combined.pdf?ids=${res.payments.map((p) => p.id).join(',')}`, 'receipt.pdf');
      onDone();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <table style={{ marginBottom: 8 }}>
          <thead><tr><th>Fee month</th><th>Student</th><th>Due</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
          <tbody>
            {invoices.map((i) => <tr key={i.id}><td>{i.period_label}</td><td>{i.student_name}</td><td>{i.due_date}</td><td style={{ textAlign: 'right' }}>{money(i.balance)}</td></tr>)}
            <tr><td colSpan={3}><b>Total owed</b></td><td style={{ textAlign: 'right' }}><b>{money(owed)}</b></td></tr>
          </tbody>
        </table>
        <div className="form-grid">
          <div className="field"><label>Amount received</label><input type="number" min="0" step="any" max={allowAdvance ? undefined : owed} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="field"><label>Discount (optional)</label><input type="number" min="0" step="any" max={owed} placeholder="0" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></div>
          <div className="field"><label>Date</label><DateInput value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></div>
          <div className="field"><label>Payment mode</label><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          {needsReference(f.payment_method) && <div className="field"><label>{referenceLabel(f.payment_method)}</label><input value={f.payment_reference} onChange={(e) => setF({ ...f, payment_reference: e.target.value })} /></div>}
        </div>
        {Number(f.discount) > 0 && <p className="muted" style={{ fontSize: '0.8rem' }}>Discount <b>{money(f.discount)}</b> is written off, so the vouchers it covers are marked <b>Paid</b> instead of Partial. It shows in the “Discounts Given” total.</p>}
        {extra > 0 && allowAdvance && <p style={{ fontSize: '0.85rem', color: 'var(--success)' }}>Extra <b>{money(extra)}</b> will be kept as <b>advance</b> and taken off the next voucher automatically.</p>}
        <p className="muted" style={{ fontSize: '0.8rem' }}>Applied to the oldest dues first. Received by <b>{receivedBy}</b>; one receipt is printed for everything.</p>
        <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Receive & Print Receipt'}</button></div>
      </form>
    </Modal>
  );
}

export function FamiliesTab({ receivedBy, onChanged }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [multi, setMulti] = useState(true);
  const [rows, setRows] = useState([]);
  const [paying, setPaying] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api.get(`/fees/families?search=${encodeURIComponent(search)}&multi=${multi ? '1' : '0'}`).then(setRows).catch((e) => toast.error(e.message));
  }, [search, multi, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay(r) {
    try {
      const d = await api.get(`/fees/families/${r.id}`);
      const invoices = d.children.flatMap((c) => c.invoices);
      if (!invoices.length) return toast.info('Nothing is due for this family');
      setPaying({ family: r, invoices, owed: d.total });
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="card">
      <div className="row filters" style={{ marginBottom: 10 }}>
        <input placeholder="Search parent, phone or child…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="row" style={{ margin: 0, gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Only families with 2 or more children</label>
      </div>
      <table>
        <thead><tr><th>Parent / Guardian</th><th>Phone</th><th>Children</th><th style={{ textAlign: 'right' }}>Total due</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.full_name}</b></td><td>{r.phone}</td><td>{r.children} — <span className="muted">{r.names}</span></td>
              <td style={{ textAlign: 'right', color: r.outstanding > 0 ? 'var(--danger)' : undefined }}><b>{money(r.outstanding)}</b></td>
              <td><div className="actions-cell">
                <ShareButtons iconOnly path={`/fees/families/${r.id}/voucher.pdf`} filenameBase={`family-voucher-${r.id}`} />
                {r.outstanding > 0 && <button type="button" className="btn-success btn-sm" onClick={() => pay(r)}>Receive payment</button>}
              </div></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No families found. Brothers and sisters are grouped by the same parent / guardian record.</td></tr>}
        </tbody>
      </table>
      {paying && (
        <PayDuesModal title={`Family payment — ${paying.family.full_name}`} endpoint={`/fees/families/${paying.family.id}/pay`} owed={paying.owed} invoices={paying.invoices}
          receivedBy={receivedBy} onClose={() => setPaying(null)} onDone={() => { setPaying(null); setTick((t) => t + 1); onChanged(); }} />
      )}
    </div>
  );
}

export function AutoFeesCard({ canManage, heads }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [extras, setExtras] = useState([]);
  async function load() {
    const d = await api.get('/fees/auto-settings');
    setS(d);
    try { setExtras(JSON.parse(d.auto_fee_extras || '[]')); } catch { setExtras([]); }
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  async function save() {
    try {
      await api.put('/fees/auto-settings', {
        auto_fee_enabled: s.auto_fee_enabled === 'true' ? 'true' : 'false', auto_fee_day: s.auto_fee_day || '1', auto_fee_due_day: s.auto_fee_due_day || '10',
        auto_fee_academic_year: s.auto_fee_academic_year || '', auto_fee_extras: extras, voucher_note: s.voucher_note || '', fee_late_fine: s.fee_late_fine || '0'
      });
      toast.success('Saved');
      load();
    } catch (err) { toast.error(err.message); }
  }
  async function runNow() {
    if (!window.confirm('Generate this month’s fee invoices for all classes now? Students who already have this month’s invoice are skipped.')) return;
    try {
      const r = await api.post('/fees/auto-run-now', {});
      toast.success(`${r.month}: ${r.created} invoice(s) created, ${r.skipped} already existed`);
      load();
    } catch (err) { toast.error(err.message); }
  }
  const set = (k, v) => setS({ ...s, [k]: v });
  return (
    <div className="grid two-col">
      <div className="card">
        <h3>Automatic Monthly Fees</h3>
        <label className="row" style={{ margin: '0 0 10px' }}><input type="checkbox" style={{ width: 'auto' }} disabled={!canManage} checked={s.auto_fee_enabled === 'true'} onChange={(e) => set('auto_fee_enabled', e.target.checked ? 'true' : 'false')} /> Generate every class’s monthly fee invoices automatically</label>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div className="field"><label>On day of the month</label><input type="number" min="1" max="28" value={s.auto_fee_day || '1'} onChange={(e) => set('auto_fee_day', e.target.value)} /></div>
          <div className="field"><label>Due date (day)</label><input type="number" min="1" max="28" value={s.auto_fee_due_day || '10'} onChange={(e) => set('auto_fee_due_day', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Fee structure year</label><input value={s.auto_fee_academic_year || ''} placeholder={s.academic_year || 'e.g. 2026'} onChange={(e) => set('auto_fee_academic_year', e.target.value)} /></div>
        </div>
        <label>Extra monthly charges on every invoice <span className="muted">(optional)</span></label>
        {extras.map((x, i) => (
          <div key={i} className="row" style={{ margin: '4px 0' }}>
            <input list="head-names" placeholder="e.g. Computer Lab" value={x.name} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
            <input type="number" min="0" style={{ maxWidth: 120 }} value={x.amount} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <datalist id="head-names">{heads.map((h) => <option key={h.id} value={h.name} />)}</datalist>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setExtras([...extras, { name: '', amount: '' }])}>+ Add charge</button>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Runs on the server PC on the chosen day (or the next time the app is opened after it), once a month, for every current student, using the class fee structures + transport fares.
          Last run: {s.last_result ? `${s.last_result.month} — ${s.last_result.created} created, ${s.last_result.skipped} skipped (${s.last_result.at})` : 'never'}.
        </p>
        {canManage && <div className="row"><button type="button" onClick={save}>Save</button><button type="button" className="btn-secondary" onClick={runNow}>Generate this month now</button></div>}
      </div>
      <div className="card">
        <h3>Voucher Settings</h3>
        <div className="field"><label>Late payment fine (shown as “after due date” amount)</label><input type="number" min="0" value={s.fee_late_fine || ''} onChange={(e) => set('fee_late_fine', e.target.value)} /></div>
        <div className="field"><label>Note printed on every voucher</label><textarea rows={3} value={s.voucher_note || ''} placeholder="e.g. Pay at Meezan Bank A/C 0123-456789 or at the school office, 8am–1pm." onChange={(e) => set('voucher_note', e.target.value)} /></div>
        {canManage && <button type="button" onClick={save}>Save</button>}
      </div>
    </div>
  );
}


// Search a student by name / ID / admission number.
export function StudentPicker({ value, onChange, autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (value || q.trim().length < 1) { setRows([]); return undefined; }
    const t = setTimeout(() => {
      api.get(`/students?limit=12&search=${encodeURIComponent(q.trim())}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) {
    return (
      <div className="row" style={{ margin: 0, alignItems: 'center' }}>
        <b>{value.full_name}</b><span className="muted">{value.student_code} · {value.class_name} {value.section_name}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div className="student-picker">
      <input autoFocus={autoFocus} placeholder="Type student name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length > 0 && (
        <div className="student-picker-list">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => { onChange(r); setRows([]); }}>
              <b>{r.full_name}</b> <span className="muted">{r.student_code} · {r.class_name} {r.section_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One voucher for one student — any month, any fee head, any extra charges.
export function SingleVoucherModal({ heads, onClose, onDone }) {
  const toast = useToast();
  const now = new Date();
  const [student, setStudent] = useState(null);
  const [f, setF] = useState({
    period_label: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    due_date: localDateStr(new Date(now.getFullYear(), now.getMonth(), 10)),
    academic_year: String(now.getFullYear()), fee_head_id: '', months_covered: 1, include_class_fees: true, extras: []
  });
  const [advance, setAdvance] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!student) { setAdvance(0); return; }
    api.get(`/fees/students/${student.id}/advance`).then((a) => setAdvance(a.balance)).catch(() => setAdvance(0));
  }, [student]);
  async function submit(e) {
    e.preventDefault();
    if (!student) { toast.error('Pick a student first'); return; }
    const extras = f.extras.filter((x) => String(x.name).trim() && Number(x.amount) > 0).map((x) => ({ name: x.name, amount: Number(x.amount) }));
    if (!f.include_class_fees && !extras.length) { toast.error('Add at least one charge, or tick “Include the class fees”'); return; }
    setSaving(true);
    try {
      const res = await api.post('/fees/invoices/generate-bulk', {
        student_id: student.id, academic_year: f.academic_year, period_label: f.period_label, due_date: f.due_date,
        months_covered: Number(f.months_covered) || 1,
        fee_head_id: f.include_class_fees ? (f.fee_head_id || undefined) : undefined,
        class_fees: f.include_class_fees, extra_items: extras
      });
      if (!res.created) {
        toast.error(res.skipped ? `${student.full_name} already has a voucher for ${f.period_label}. Open it from the Invoices list, or use another fee month.` : 'Nothing to bill — this class has no fee structure. Add a charge instead.');
        return;
      }
      toast.success(`Voucher created for ${student.full_name}`);
      downloadFile(`/fees/invoices/${res.invoiceIds[0]}/voucher.pdf`, `voucher-${student.student_code}.pdf`);
      onDone();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  const upd = (i, patch) => setF({ ...f, extras: f.extras.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
  return (
    <Modal title="Single Student Voucher" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="field"><label>Student</label><StudentPicker value={student} onChange={setStudent} autoFocus /></div>
        {advance > 0 && <p style={{ color: 'var(--success)', margin: '0 0 8px' }}>This student has <b>{money(advance)}</b> in advance — it will be taken off this voucher automatically.</p>}
        <div className="form-grid">
          <div className="field"><label>Fee month</label><input required value={f.period_label} onChange={(e) => setF({ ...f, period_label: e.target.value })} placeholder="e.g. December 2026" /></div>
          <div className="field"><label>Due date</label><DateInput required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
          <div className="field"><label>Academic year</label><input required value={f.academic_year} onChange={(e) => setF({ ...f, academic_year: e.target.value })} /></div>
          <div className="field"><label>Months covered</label><input type="number" min="1" value={f.months_covered} onChange={(e) => setF({ ...f, months_covered: e.target.value })} /></div>
        </div>
        <label className="row" style={{ margin: '4px 0' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.include_class_fees} onChange={(e) => setF({ ...f, include_class_fees: e.target.checked })} /> Include the class fees (from Fee Structures)</label>
        {f.include_class_fees && (
          <div className="field"><label>Which fee heads</label>
            <select value={f.fee_head_id} onChange={(e) => setF({ ...f, fee_head_id: e.target.value })}>
              <option value="">All fee heads of the class</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name} only</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>Other charges <span className="muted">(admission, fine, trip, uniform…)</span></label>
          {f.extras.map((x, i) => (
            <div key={i} className="row" style={{ margin: '4px 0' }}>
              <input list="single-head-names" placeholder="e.g. Admission Fee" value={x.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <input type="number" min="0" step="any" placeholder="Amount" style={{ maxWidth: 130 }} value={x.amount} onChange={(e) => upd(i, { amount: e.target.value })} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ ...f, extras: f.extras.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <datalist id="single-head-names">{heads.map((h) => <option key={h.id} value={h.name} />)}</datalist>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ ...f, extras: [...f.extras, { name: '', amount: '' }] })}>+ Add charge</button>
        </div>
        <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create & Print Voucher'}</button></div>
      </form>
    </Modal>
  );
}

// Money received before a voucher exists — kept and used on the next voucher(s).
export function AdvanceModal({ onClose, onDone, receivedBy }) {
  const toast = useToast();
  const [student, setStudent] = useState(null);
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ amount: '', payment_method: 'Cash', notes: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!student) { setInfo(null); return; }
    Promise.all([api.get(`/fees/students/${student.id}/advance`), api.get(`/fees/students/${student.id}/dues`)])
      .then(([a, d]) => setInfo({ advance: a.balance, owed: d.total })).catch(() => setInfo(null));
  }, [student]);
  async function submit(e) {
    e.preventDefault();
    if (!student) { toast.error('Pick a student first'); return; }
    setSaving(true);
    try {
      const res = await api.post(`/fees/students/${student.id}/advance`, { ...f, amount: Number(f.amount) });
      toast.success(`${money(f.amount)} received${res.used > 0 ? ` — ${money(res.used)} paid off current dues` : ''}. Advance now ${money(res.balance)}.`);
      downloadFile(`/fees/advances/${res.id}/receipt.pdf`, `receipt-${res.receipt_number}.pdf`);
      onDone();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal title="Receive Advance Fee" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Student</label><StudentPicker value={student} onChange={setStudent} autoFocus /></div>
        {info && <p className="muted">Advance already held: <b>{money(info.advance)}</b> · Currently owed: <b>{money(info.owed)}</b>{info.owed > 0 ? ' (paid first from this amount)' : ''}</p>}
        <div className="form-grid">
          <div className="field"><label>Amount received</label><input type="number" min="1" step="any" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="field"><label>Payment mode</label><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        <div className="field"><label>Notes</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. 3 months in advance" /></div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>When the next voucher is generated, the advance is taken off it automatically and the voucher shows “adjusted from advance”. Received by <b>{receivedBy}</b>.</p>
        <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Receive & Print Receipt'}</button></div>
      </form>
    </Modal>
  );
}
