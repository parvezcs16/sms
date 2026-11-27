import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReceiptsList from '../components/ReceiptsList';
import { PrintVouchersModal, PayDuesModal, FamiliesTab, AutoFeesCard, SingleVoucherModal, AdvanceModal } from '../components/FeeExtras';
import StatCard from '../components/StatCard';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import ShareButtons from '../components/ShareButtons';
import FeeHeadInput from '../components/FeeHeadInput';
import InvoiceModal from '../components/InvoiceModal';
import { localDateStr } from '../utils/date';
import IconButton from '../components/IconButton';
import { PAYMENT_MODES, needsReference, referenceLabel } from '../utils/payment';
import { useAuth } from '../context/AuthContext';
import DateInput from '../components/DateInput';

const amt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function FeesPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'invoices';
  const setTab = (t) => setParams(t === 'invoices' ? {} : { tab: t }, { replace: true });
  const [invoices, setInvoices] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [structures, setStructures] = useState([]);
  const [heads, setHeads] = useState([]);
  const [classes, setClasses] = useState([]);
  const [search, setSearch] = useState('');
  const [payModal, setPayModal] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', discount: '', payment_method: 'Cash', notes: '', payment_date: '' });
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState([]);
  const [showSingle, setShowSingle] = useState(false);
  const [showAdvance, setShowAdvance] = useState(false);
  const [sections, setSections] = useState([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkMode, setBulkMode] = useState('single'); // 'single' (one period, optionally multi-month) | 'multi' (several separate month invoices)
  const [bulkForm, setBulkForm] = useState({
    class_id: '', section_id: '', fee_head_id: '', academic_year: String(new Date().getFullYear()),
    period_label: '', due_date: '', months_covered: 1,
    start_month: '', month_count: 3, due_day: 10, extras: []
  });
  const [showPrint, setShowPrint] = useState(false);
  const [dues, setDues] = useState(null);
  const [structureForm, setStructureForm] = useState({ class_id: '', fee_head_name: '', amount: '', frequency: 'Monthly', academic_year: String(new Date().getFullYear()) });
  const [headForm, setHeadForm] = useState('');
  const [openInvoice, setOpenInvoice] = useState(null);
  const [editStructure, setEditStructure] = useState(null);
  const [renameHead, setRenameHead] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);

  async function loadInvoices(q = search) { setInvoices(await api.get(`/fees/invoices?search=${encodeURIComponent(q)}`)); }
  async function loadOutstanding() {
    setOutstanding(await api.get('/fees/outstanding'));
    api.get('/fees/summary').then(setSummary).catch(() => {});
  }
  async function loadStructures() { setStructures(await api.get('/fees/structures')); }
  async function loadRefs() {
    setHeads(await api.get('/fees/heads'));
    setClasses(await api.get('/academics/classes'));
    setSections(await api.get('/academics/sections'));
  }

  useEffect(() => { loadInvoices(); loadOutstanding(); loadStructures(); loadRefs(); }, []);

  // If the student also owes earlier months, offer to take everything at once (oldest first).
  async function openPay(row) {
    try {
      const d = await api.get(`/fees/students/${row.student_id}/dues`);
      if (d.invoices.length > 1) {
        setDues({ row, ...d });
        return;
      }
    } catch { /* fall back to a single payment */ }
    setPayModal(row);
  }

  async function submitPayment(e) {
    e.preventDefault();
    try {
      const result = await api.post(`/fees/invoices/${payModal.id}/pay`, { ...payForm, amount: Number(payForm.amount || 0), discount: Number(payForm.discount || 0), payment_date: payForm.payment_date || localDateStr() });
      toast.success(`Payment recorded (Receipt ${result.receipt_number})${result.advance > 0 ? ` — ${result.advance.toFixed(2)} kept as advance` : ''}`);
      downloadFile(`/fees/payments/${result.id}/receipt.pdf`, `receipt-${result.receipt_number}.pdf`);
      setPayModal(null);
      setPayForm({ amount: '', discount: '', payment_method: 'Cash', notes: '', payment_date: '', payment_reference: '' });
      loadInvoices(); loadOutstanding();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function buildMonthlyPeriods({ start_month, month_count, due_day }) {
    const [startYear, startMonth] = start_month.split('-').map(Number);
    const periods = [];
    for (let i = 0; i < Number(month_count); i += 1) {
      const monthDate = new Date(startYear, startMonth - 1 + i, 1);
      const label = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const dueDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), Number(due_day) || 10);
      periods.push({ period_label: label, due_date: localDateStr(dueDate) });
    }
    return periods;
  }

  async function submitBulk(e) {
    e.preventDefault();
    try {
      const payload = {
        class_id: bulkForm.class_id || undefined,
        section_id: bulkForm.section_id || undefined,
        fee_head_id: bulkForm.fee_head_id || undefined,
        academic_year: bulkForm.academic_year
      };
      if (bulkMode === 'single') {
        payload.period_label = bulkForm.period_label;
        payload.due_date = bulkForm.due_date;
        payload.months_covered = Number(bulkForm.months_covered) || 1;
      } else {
        if (!bulkForm.start_month) throw new Error('Pick a starting month');
        payload.periods = buildMonthlyPeriods(bulkForm);
      }
      payload.extra_items = bulkForm.extras.filter((x) => String(x.name).trim() && Number(x.amount) > 0).map((x) => ({ name: x.name, amount: Number(x.amount), per_month: Boolean(x.per_month) }));
      const result = await api.post('/fees/invoices/generate-bulk', payload);
      toast.success(`Generated ${result.created} invoice(s)${result.skipped ? ` — ${result.skipped} student(s) already had one for this month and were skipped` : ''}`);
      setShowBulk(false);
      loadInvoices(); loadOutstanding();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitStructure(e) {
    e.preventDefault();
    try {
      await api.post('/fees/structures', { ...structureForm, fee_head_name: structureForm.fee_head_name.trim(), amount: Number(structureForm.amount) });
      toast.success('Fee structure saved');
      loadStructures();
      loadRefs();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitHead(e) {
    e.preventDefault();
    if (!headForm.trim()) return;
    try {
      const r = await api.post('/fees/heads', { name: headForm });
      if (r.existed) toast.info(`“${r.name}” is already in the list`);
      else toast.success(`Fee head “${r.name}” added`);
      setHeadForm('');
      loadRefs();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveStructure(e) {
    e.preventDefault();
    try {
      await api.put(`/fees/structures/${editStructure.id}`, { amount: Number(editStructure.amount), frequency: editStructure.frequency, academic_year: editStructure.academic_year });
      toast.success('Fee structure updated. New invoices use the new amount; open an invoice to correct it individually.');
      setEditStructure(null);
      loadStructures();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteStructure(s) {
    if (!window.confirm(`Remove ${s.fee_head_name} (${s.amount}) from ${s.class_name} for ${s.academic_year}? Existing invoices are not changed.`)) return;
    try {
      await api.del(`/fees/structures/${s.id}`);
      loadStructures();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveHead(e) {
    e.preventDefault();
    try {
      await api.put(`/fees/heads/${renameHead.id}`, { name: renameHead.name });
      setRenameHead(null);
      loadRefs(); loadStructures(); loadInvoices();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteHead(h) {
    if (!window.confirm(`Delete fee head "${h.name}"?`)) return;
    try {
      await api.del(`/fees/heads/${h.id}`);
      setRenameHead(null);
      loadRefs();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function sendReminders() {
    const result = await api.post('/fees/remind-overdue', {});
    toast.success(`Sent reminders for ${result.notified} overdue invoices`);
  }

  async function sendVoucher(invoiceId) {
    try {
      const result = await api.post(`/fees/invoices/${invoiceId}/send-voucher`, {});
      toast.success(`Voucher sent (${result.summary.sent} delivered, ${result.summary.simulated} simulated)`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Fees &amp; Accounts</h2>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={sendReminders}>Send Due Reminders</button>
          <button type="button" className="btn-secondary" onClick={() => setShowAdvance(true)}>Receive Advance</button>
          <button type="button" className="btn-secondary" onClick={() => setShowPrint(true)}>Print Vouchers</button>
          <button type="button" className="btn-secondary" onClick={() => setShowSingle(true)}>Single Student Voucher</button>
          <button type="button" onClick={() => setShowBulk(true)}>Bulk Generate Invoices</button>
        </div>
      </div>

      {summary && (
        <div className="kpi-grid auto" style={{ marginBottom: 16 }}>
          <StatCard tone="students" icon="receipt" label="Total Amount" value={amt(summary.billed)} sub={`${summary.invoices} voucher${summary.invoices === 1 ? '' : 's'} (cancelled left out)`} />
          <StatCard tone="teachers" icon="check" label="Paid" value={amt(summary.paid)} sub="received on vouchers" />
          <StatCard tone="absent" icon="clock" label="Pending Pays" value={amt(summary.pending)} sub={`${summary.open} voucher${summary.open === 1 ? '' : 's'} not fully paid`} onClick={() => setTab('outstanding')} />
          <StatCard tone="discount" icon="money" label="Discounts Given" value={amt(summary.discounts)} sub="less profit — written off at the counter" />
          <StatCard tone="advance" icon="wallet" label="Advance Held" value={amt(summary.advance)} sub={`${summary.advanceStudents} student${summary.advanceStudents === 1 ? '' : 's'} · used on next vouchers`} />
        </div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'invoices' ? '' : 'btn-ghost'} onClick={() => setTab('invoices')}>Invoices</button>
        <button type="button" className={tab === 'challans' ? '' : 'btn-ghost'} onClick={() => setTab('challans')}>Receipts</button>
        <button type="button" className={tab === 'outstanding' ? '' : 'btn-ghost'} onClick={() => setTab('outstanding')}>Outstanding Dues</button>
        <button type="button" className={tab === 'families' ? '' : 'btn-ghost'} onClick={() => setTab('families')}>Families</button>
        <button type="button" className={tab === 'structures' ? '' : 'btn-ghost'} onClick={() => setTab('structures')}>Fee Structures</button>
        <button type="button" className={tab === 'auto' ? '' : 'btn-ghost'} onClick={() => setTab('auto')}>Auto Monthly &amp; Voucher</button>
      </div>

      {tab === 'challans' && <ReceiptsList onOpenInvoice={setOpenInvoice} />}
      {tab === 'families' && <FamiliesTab receivedBy={user.full_name} onChanged={() => { loadInvoices(); loadOutstanding(); }} />}
      {tab === 'auto' && <AutoFeesCard canManage={can('fees', 'manage')} heads={heads} />}

      {tab === 'invoices' && (
        <div className="card">
          <div className="row" style={{ margin: '0 0 8px', alignItems: 'center' }}>
            <label className="row" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled invoices</label>
            {selected.length > 0 && <>
              <button type="button" className="btn-sm" onClick={() => setShowPrint(true)}>Print {selected.length} selected voucher{selected.length === 1 ? '' : 's'}</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected([])}>Clear selection</button>
            </>}
          </div>
          <DataTable
            search={search} onSearchChange={(v) => { setSearch(v); loadInvoices(v); }}
            columns={[
              { key: 'pick', label: <input type="checkbox" style={{ width: 'auto' }} title="Select all shown" checked={invoices.length > 0 && invoices.filter((i) => i.status !== 'Cancelled').every((i) => selected.includes(i.id))} onChange={(e) => setSelected(e.target.checked ? invoices.filter((i) => i.status !== 'Cancelled').map((i) => i.id) : [])} />,
                render: (r) => r.status === 'Cancelled' ? null : <input type="checkbox" style={{ width: 'auto' }} checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} /> },
              { key: 'invoice_number', label: 'Invoice', render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); setOpenInvoice(r.id); }}>{r.invoice_number}{r.updated_at && <span className="edited-tag">EDITED</span>}</a> },
              { key: 'student_name', label: 'Student' },
              { key: 'class_name', label: 'Class', render: (r) => `${r.class_name || ''} ${r.section_name || ''}` },
              { key: 'period_label', label: 'Period' },
              { key: 'fee_head_name', label: 'Type', render: (r) => r.fee_head_name ? <Badge variant="muted">{r.fee_head_name}</Badge> : <span className="muted">All heads</span> },
              { key: 'total_amount', label: 'Total', render: (r) => (r.total_amount + (r.fine_amount || 0)).toFixed(2) }, { key: 'paid_amount', label: 'Paid', render: (r) => r.paid_amount.toFixed(2) },
              { key: 'concession_amount', label: 'Discount', render: (r) => r.concession_amount > 0 ? r.concession_amount.toFixed(2) : <span className="muted">—</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }
            ]}
            rows={showCancelled ? invoices : invoices.filter((i) => i.status !== 'Cancelled')}
            rowActions={(row) => (
              <>
                <IconButton icon="edit" tone="primary" label="View / edit invoice" onClick={() => setOpenInvoice(row.id)} />
                {row.status !== 'Paid' && row.status !== 'Cancelled' && <IconButton icon="pay" tone="success" label="Record payment" onClick={() => openPay(row)} />}
                <ShareButtons iconOnly path={`/fees/invoices/${row.id}/voucher.pdf`} filenameBase={`voucher-${row.invoice_number}`} />
                <IconButton icon="send" tone="default" label="Send via WhatsApp / SMS / Email" onClick={() => sendVoucher(row.id)} />
              </>
            )}
          />
        </div>
      )}

      {tab === 'outstanding' && (
        <div className="card">
          <div className="page-header"><h3>Outstanding Dues</h3><button type="button" className="btn-secondary" onClick={() => downloadFile('/reports/fee-collection?format=excel', 'fee-collection.xlsx')}>Export Collections</button></div>
          <table>
            <thead><tr><th>Student</th><th>Class</th><th>Invoice</th><th>Due Date</th><th>Balance</th></tr></thead>
            <tbody>
              {outstanding.map((o) => (
                <tr key={o.id}><td>{o.student_name}</td><td>{o.class_name} {o.section_name}</td><td><a href="#" onClick={(e) => { e.preventDefault(); setOpenInvoice(o.id); }}>{o.invoice_number}</a></td><td>{o.due_date}</td><td>{o.balance.toFixed(2)}</td></tr>
              ))}
              {outstanding.length === 0 && <tr><td colSpan={5} className="muted">No outstanding dues 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'structures' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Fee Structures</h3>
            <table>
              <thead><tr><th>Class</th><th>Fee Head</th><th>Amount</th><th>Frequency</th><th>Year</th><th /></tr></thead>
              <tbody>{structures.map((s) => (
                <tr key={s.id}>
                  <td>{s.class_name}</td><td>{s.fee_head_name}</td><td>{s.amount}</td><td>{s.frequency}</td><td>{s.academic_year}</td>
                  <td><div className="actions-cell">
                    <IconButton icon="edit" tone="primary" label="Edit" onClick={() => setEditStructure({ ...s, amount: String(s.amount) })} />
                    <IconButton icon="trash" tone="danger" label="Remove" onClick={() => deleteStructure(s)} />
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
            <h3 style={{ marginTop: 20 }}>Fee Heads</h3>
            <div className="row">{heads.map((h) => (renameHead && renameHead.id === h.id ? (
              <form key={h.id} className="inline-edit" onSubmit={saveHead}>
                <input autoFocus value={renameHead.name} onChange={(e) => setRenameHead({ ...renameHead, name: e.target.value })} />
                <button type="submit" className="btn-sm">Save</button>
                <IconButton icon="trash" tone="danger" label="Delete" onClick={() => deleteHead(h)} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => setRenameHead(null)}>Cancel</button>
              </form>
            ) : (
              <button key={h.id} type="button" className="btn-ghost btn-sm" title="Click to rename or delete" onClick={() => setRenameHead({ id: h.id, name: h.name })}>{h.name} ✎</button>
            )))}</div>
            <form onSubmit={submitHead} className="row" style={{ marginTop: 10 }}>
              <input placeholder="New fee head (e.g. Uniform)" value={headForm} onChange={(e) => setHeadForm(e.target.value)} />
              <button type="submit">Add</button>
              {can('fees', 'manage') && <button type="button" className="btn-ghost btn-sm" title="Adds any missing common heads: Tuition, Admission, Exam, Transport, Library, Fine, Late Fee, Trip, Annual, Sports, Computer Lab, Miscellaneous"
                onClick={async () => { try { const r = await api.post('/fees/heads/common', {}); toast.success(r.added ? `${r.added} common fee head(s) added` : 'All common fee heads are already there'); loadRefs(); } catch (err) { toast.error(err.message); } }}>+ Add common heads</button>}
            </form>
          </div>
          <div className="card">
            <h3>Add / Update Fee Structure</h3>
            <form onSubmit={submitStructure}>
              <div className="field"><label>Class</label>
                <select required value={structureForm.class_id} onChange={(e) => setStructureForm({ ...structureForm, class_id: e.target.value })}>
                  <option value="">Select</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Fee Head</label>
                <FeeHeadInput required heads={heads} value={structureForm.fee_head_name} onChange={(v) => setStructureForm({ ...structureForm, fee_head_name: v })} />
              </div>
              <div className="field"><label>Amount</label><input type="number" required value={structureForm.amount} onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })} /></div>
              <div className="field"><label>Frequency</label>
                <select value={structureForm.frequency} onChange={(e) => setStructureForm({ ...structureForm, frequency: e.target.value })}>
                  <option>Monthly</option><option>Quarterly</option><option>Annual</option><option>OneTime</option>
                </select>
              </div>
              <div className="field"><label>Academic Year</label><input value={structureForm.academic_year} onChange={(e) => setStructureForm({ ...structureForm, academic_year: e.target.value })} /></div>
              <button type="submit">Save Structure</button>
            </form>
          </div>
        </div>
      )}

      {openInvoice && (
        <InvoiceModal invoiceId={openInvoice} heads={heads} onClose={() => setOpenInvoice(null)} onChanged={() => { loadInvoices(); loadOutstanding(); loadRefs(); }} />
      )}
      {editStructure && (
        <Modal title={`Edit Fee — ${editStructure.class_name} / ${editStructure.fee_head_name}`} onClose={() => setEditStructure(null)}>
          <form onSubmit={saveStructure}>
            <div className="field"><label>Amount</label><input type="number" min="0" required value={editStructure.amount} onChange={(e) => setEditStructure({ ...editStructure, amount: e.target.value })} /></div>
            <div className="field"><label>Frequency</label>
              <select value={editStructure.frequency} onChange={(e) => setEditStructure({ ...editStructure, frequency: e.target.value })}>
                <option>Monthly</option><option>Quarterly</option><option>Annual</option><option>OneTime</option>
              </select>
            </div>
            <div className="field"><label>Academic Year</label><input required value={editStructure.academic_year} onChange={(e) => setEditStructure({ ...editStructure, academic_year: e.target.value })} /></div>
            <p className="muted">Invoices already generated keep their amounts — open an invoice to correct it.</p>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setEditStructure(null)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {payModal && (
        <Modal title={`Record Payment — ${payModal.invoice_number}`} onClose={() => setPayModal(null)}>
          <p className="muted">Balance due: {(payModal.total_amount + payModal.fine_amount - payModal.paid_amount).toFixed(2)}</p>
          <form onSubmit={submitPayment}>
            <div className="form-grid">
              <div className="field"><label>Amount received</label><input type="number" min="0" step="any" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></div>
              <div className="field"><label>Discount (optional)</label><input type="number" min="0" step="any" placeholder="0" value={payForm.discount} onChange={(e) => setPayForm({ ...payForm, discount: e.target.value })} /></div>
            </div>
            {(() => {
              const bal = payModal.total_amount + payModal.fine_amount - payModal.paid_amount;
              const after = bal - Number(payForm.amount || 0) - Number(payForm.discount || 0);
              if (Number(payForm.discount) > 0 && after <= 0.001) return <p className="muted" style={{ fontSize: '0.8rem' }}>With the discount this voucher is marked <b>Paid</b>. The discount is added to “Discounts Given”.</p>;
              if (after < -0.001) return <p style={{ fontSize: '0.85rem', color: 'var(--success)' }}>Extra <b>{(-after).toFixed(2)}</b> will be kept as <b>advance</b> and taken off the next voucher automatically.</p>;
              if (after > 0.001 && (payForm.amount || payForm.discount)) return <p className="muted" style={{ fontSize: '0.8rem' }}>{after.toFixed(2)} will still be due (Partial). Add a discount to close it.</p>;
              return null;
            })()}
            <div className="form-grid">
              <div className="field"><label>Payment Mode</label>
                <select value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}>
                  {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              {needsReference(payForm.payment_method) && (
                <div className="field"><label>{referenceLabel(payForm.payment_method)}</label><input value={payForm.payment_reference || ''} onChange={(e) => setPayForm({ ...payForm, payment_reference: e.target.value })} /></div>
              )}
            </div>
            <div className="field"><label>Payment Date</label><DateInput value={payForm.payment_date || localDateStr()} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} /></div>
            <div className="field"><label>Notes</label><input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} /></div>
            <p className="muted" style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>Received by <b>{user.full_name}</b> — your name and the exact time are saved and printed on the receipt.</p>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setPayModal(null)}>Cancel</button>
              <button type="submit">Record Payment &amp; Print Receipt</button>
            </div>
          </form>
        </Modal>
      )}

      {showPrint && <PrintVouchersModal classes={classes} sections={sections} periods={[...new Set(invoices.map((i) => i.period_label))]} selectedIds={tab === 'invoices' ? selected : []} onClose={() => setShowPrint(false)} />}
      {showSingle && <SingleVoucherModal heads={heads} onClose={() => setShowSingle(false)} onDone={() => { setShowSingle(false); loadInvoices(); loadOutstanding(); }} />}
      {showAdvance && <AdvanceModal receivedBy={user.full_name} onClose={() => setShowAdvance(false)} onDone={() => { setShowAdvance(false); loadInvoices(); loadOutstanding(); }} />}
      {dues && (
        <PayDuesModal title={`Receive fees — ${dues.row.student_name} (includes arrears)`} endpoint={`/fees/students/${dues.row.student_id}/pay-dues`} owed={dues.total} invoices={dues.invoices}
          receivedBy={user.full_name} allowAdvance onClose={() => setDues(null)} onDone={() => { setDues(null); loadInvoices(); loadOutstanding(); }} />
      )}

      {showBulk && (
        <Modal title="Bulk Generate Invoices" onClose={() => setShowBulk(false)} wide>
          <form onSubmit={submitBulk}>
            <div className="form-grid">
              <div className="field"><label>Class (leave blank for all)</label>
                <select value={bulkForm.class_id} onChange={(e) => setBulkForm({ ...bulkForm, class_id: e.target.value, section_id: '' })}>
                  <option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Section (optional — narrows to just one section)</label>
                <select value={bulkForm.section_id} onChange={(e) => setBulkForm({ ...bulkForm, section_id: e.target.value })}>
                  <option value="">Whole class</option>
                  {sections.filter((s) => !bulkForm.class_id || String(s.class_id) === String(bulkForm.class_id)).map((s) => (
                    <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div className="field"><label>Fee Head</label>
                <select value={bulkForm.fee_head_id} onChange={(e) => setBulkForm({ ...bulkForm, fee_head_id: e.target.value })}>
                  <option value="">All fee heads for the class</option>
                  {heads.map((h) => <option key={h.id} value={h.id}>{h.name} only (e.g. Exam Fee)</option>)}
                </select>
              </div>
              <div className="field"><label>Academic Year</label><input required value={bulkForm.academic_year} onChange={(e) => setBulkForm({ ...bulkForm, academic_year: e.target.value })} /></div>
            </div>

            <div className="row" style={{ margin: '10px 0' }}>
              <button type="button" className={bulkMode === 'single' ? '' : 'btn-ghost'} onClick={() => setBulkMode('single')}>Single Period</button>
              <button type="button" className={bulkMode === 'multi' ? '' : 'btn-ghost'} onClick={() => setBulkMode('multi')}>Multiple Months</button>
            </div>

            {bulkMode === 'single' ? (
              <>
                <div className="field"><label>Period Label</label><input required placeholder="e.g. August 2026, or Jan-Feb 2026" value={bulkForm.period_label} onChange={(e) => setBulkForm({ ...bulkForm, period_label: e.target.value })} /></div>
                <div className="form-grid">
                  <div className="field"><label>Due Date</label><DateInput required value={bulkForm.due_date} onChange={(e) => setBulkForm({ ...bulkForm, due_date: e.target.value })} /></div>
                  <div className="field"><label>Months Covered</label><input type="number" min="1" value={bulkForm.months_covered} onChange={(e) => setBulkForm({ ...bulkForm, months_covered: e.target.value })} /></div>
                </div>
                <p className="muted">Months Covered multiplies monthly fees only (e.g. 2 = bill Tuition twice, for a Jan+Feb voucher) — one-time fees like an exam fee are charged once regardless.</p>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <div className="field"><label>Starting Month</label><input type="month" required value={bulkForm.start_month} onChange={(e) => setBulkForm({ ...bulkForm, start_month: e.target.value })} /></div>
                  <div className="field"><label>Number of Months</label><input type="number" min="1" max="12" value={bulkForm.month_count} onChange={(e) => setBulkForm({ ...bulkForm, month_count: e.target.value })} /></div>
                </div>
                <div className="field"><label>Due Day of Month</label><input type="number" min="1" max="28" value={bulkForm.due_day} onChange={(e) => setBulkForm({ ...bulkForm, due_day: e.target.value })} /></div>
                <p className="muted">
                  Creates a separate invoice per month — e.g. starting March with 3 months generates March, April and May invoices individually
                  (not combined into one). One-time fees are only charged on the first month's invoice.
                </p>
                {bulkForm.start_month && (
                  <p className="muted">Will generate: {buildMonthlyPeriods(bulkForm).map((p) => p.period_label).join(', ')}</p>
                )}
              </>
            )}

            <div className="field">
              <label>Extra charges on these invoices <span className="muted">(fine, trip, annual charges, anything else)</span></label>
              {bulkForm.extras.map((x, i) => {
                const upd = (patch) => setBulkForm({ ...bulkForm, extras: bulkForm.extras.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
                return (
                  <div key={i} className="row" style={{ margin: '4px 0' }}>
                    <input list="bulk-head-names" placeholder="e.g. Trip Fee" value={x.name} onChange={(e) => upd({ name: e.target.value })} />
                    <input type="number" min="0" step="any" placeholder="Amount" style={{ maxWidth: 120 }} value={x.amount} onChange={(e) => upd({ amount: e.target.value })} />
                    <label className="row" style={{ margin: 0, gap: 4, fontSize: '0.8rem' }}><input type="checkbox" style={{ width: 'auto' }} checked={Boolean(x.per_month)} onChange={(e) => upd({ per_month: e.target.checked })} /> every month</label>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setBulkForm({ ...bulkForm, extras: bulkForm.extras.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                );
              })}
              <datalist id="bulk-head-names">{['Fine', 'Trip Fee', 'Annual Charges', 'Exam Fee', 'Sports Fee', 'Miscellaneous', ...heads.map((h) => h.name)].filter((v, i, a) => a.indexOf(v) === i).map((n) => <option key={n} value={n} />)}</datalist>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setBulkForm({ ...bulkForm, extras: [...bulkForm.extras, { name: '', amount: '', per_month: false }] })}>+ Add extra charge</button>
            </div>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              <b>Arrears:</b> any earlier unpaid fees are carried forward automatically — each voucher lists them as “Arrears” and adds them to the total payable; a payment is applied to the oldest dues first.
              Students who already have an invoice for the same month are skipped, so nobody is billed twice.
            </p>

            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setShowBulk(false)}>Cancel</button>
              <button type="submit">Generate</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
