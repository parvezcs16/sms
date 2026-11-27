import { useEffect, useState } from 'react';
import { modesWith, needsReference, referenceLabel, fmtDateTime } from '../utils/payment';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import Badge from './Badge';
import ReasonModal from './ReasonModal';
import HistoryModal from './HistoryModal';

const n = (v) => Number(v || 0);

// Everything needed to fix a wrong invoice: edit fee lines / fine / dates,
// correct or void payments, cancel or restore the invoice, see its history.
import FeeHeadInput from './FeeHeadInput';
import DateInput from './DateInput';

export default function InvoiceModal({ invoiceId, heads, onClose, onChanged }) {
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    try {
      const data = await api.get(`/fees/invoices/${invoiceId}`);
      setInv(data);
      return data;
    } catch (err) {
      toast.error(err.message);
      return null;
    }
  }
  useEffect(() => { load(); }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setDraft({
      period_label: inv.period_label,
      due_date: inv.due_date,
      fine_amount: String(inv.fine_amount || 0),
      items: inv.items.map((it) => ({ fee_head_name: it.fee_head_name || '', amount: String(it.amount), discount_amount: String(it.discount_amount || 0) }))
    });
    setEditMode(true);
  }

  const draftTotal = draft ? draft.items.reduce((s, it) => s + n(it.amount) - n(it.discount_amount), 0) : 0;

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/fees/invoices/${invoiceId}`, {
        period_label: draft.period_label,
        due_date: draft.due_date,
        fine_amount: n(draft.fine_amount),
        items: draft.items.map((it) => ({ fee_head_name: String(it.fee_head_name || '').trim(), amount: n(it.amount), discount_amount: n(it.discount_amount) }))
      });
      toast.success('Invoice corrected — the old amounts are kept in its history');
      setEditMode(false);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePayment(e) {
    e.preventDefault();
    try {
      await api.put(`/fees/payments/${editPayment.id}`, {
        amount: n(editPayment.amount), payment_method: editPayment.payment_method, payment_date: editPayment.payment_date, notes: editPayment.notes, payment_reference: editPayment.payment_reference || ''
      });
      toast.success('Payment corrected');
      setEditPayment(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function verify(p) {
    if (!window.confirm(`Confirm that ${p.amount.toFixed(2)} (receipt ${p.receipt_number}) was received? Your name and the time will be recorded as the verifier.`)) return;
    try {
      await api.post(`/fees/payments/${p.id}/verify`, {});
      toast.success(`Payment ${p.receipt_number} verified`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function doVoid(reason) {
    try {
      await api.post(`/fees/payments/${voiding.id}/void`, { reason });
      toast.success(`Payment ${voiding.receipt_number} voided`);
      setVoiding(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function doCancel(reason) {
    try {
      await api.post(`/fees/invoices/${invoiceId}/cancel`, { reason });
      toast.success('Invoice cancelled — it no longer counts as money owed');
      setCancelling(false);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function restore() {
    try {
      await api.post(`/fees/invoices/${invoiceId}/restore`, {});
      toast.success('Invoice restored');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!inv) return <Modal title="Invoice" onClose={onClose}><p className="muted">Loading…</p></Modal>;

  const cancelled = inv.status === 'Cancelled';
  const activePayments = inv.payments.filter((p) => !p.voided_at);
  const balance = inv.total_amount + inv.fine_amount - inv.paid_amount;

  return (
    <Modal title={`Invoice ${inv.invoice_number} — ${inv.student_name}`} onClose={onClose} wide>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: -6 }}>
        <div><Badge>{inv.status}</Badge> <span className="muted">{inv.period_label} · due {inv.due_date}</span></div>
        <div className="row" style={{ margin: 0 }}>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowHistory(true)}>History</button>
          {!cancelled && !editMode && <button type="button" className="btn-sm" onClick={startEdit}>Edit Invoice</button>}
          {!cancelled && <button type="button" className="btn-ghost btn-sm" onClick={() => setCancelling(true)} disabled={activePayments.length > 0} title={activePayments.length ? 'Void the payments first' : ''}>Cancel Invoice</button>}
          {cancelled && <button type="button" className="btn-sm" onClick={restore}>Restore Invoice</button>}
        </div>
      </div>
      {cancelled && <div className="sync-banner sync-error">Cancelled{inv.cancel_reason ? `: ${inv.cancel_reason}` : ''}. It is kept for the record but is not counted as dues.</div>}

      {!editMode ? (
        <table>
          <thead><tr><th>Fee</th><th>Amount</th><th>Discount</th><th>Net</th></tr></thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.id}><td>{it.fee_head_name}</td><td>{it.amount.toFixed(2)}</td><td>{(it.discount_amount || 0).toFixed(2)}</td><td>{(it.amount - (it.discount_amount || 0)).toFixed(2)}</td></tr>
            ))}
            <tr><td colSpan={3}><b>Fine</b></td><td>{inv.fine_amount.toFixed(2)}</td></tr>
            <tr><td colSpan={3}><b>Total</b></td><td><b>{(inv.total_amount + inv.fine_amount).toFixed(2)}</b></td></tr>
            <tr><td colSpan={3}>Paid</td><td>{inv.paid_amount.toFixed(2)}</td></tr>
            <tr><td colSpan={3}><b>Balance</b></td><td><b>{balance.toFixed(2)}</b></td></tr>
          </tbody>
        </table>
      ) : (
        <form onSubmit={saveEdit}>
          <div className="form-grid">
            <div className="field"><label>Period</label><input required value={draft.period_label} onChange={(e) => setDraft({ ...draft, period_label: e.target.value })} /></div>
            <div className="field"><label>Due Date</label><DateInput required value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></div>
          </div>
          <table>
            <thead><tr><th>Fee Head</th><th>Amount</th><th>Discount</th><th>Net</th><th /></tr></thead>
            <tbody>
              {draft.items.map((it, i) => {
                const setItem = (f) => (e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)) });
                return (
                  <tr key={i}>
                    <td style={{ minWidth: 190 }}><FeeHeadInput compact required heads={heads} value={it.fee_head_name} onChange={(v) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, fee_head_name: v } : x)) })} /></td>
                    <td><input type="number" min="0" step="0.01" required value={it.amount} onChange={setItem('amount')} /></td>
                    <td><input type="number" min="0" step="0.01" value={it.discount_amount} onChange={setItem('discount_amount')} /></td>
                    <td>{(n(it.amount) - n(it.discount_amount)).toFixed(2)}</td>
                    <td><button type="button" className="btn-ghost btn-sm" disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setDraft({ ...draft, items: [...draft.items, { fee_head_name: '', amount: '', discount_amount: '0' }] })}>+ Add fee line</button>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field"><label>Fine</label><input type="number" min="0" step="0.01" value={draft.fine_amount} onChange={(e) => setDraft({ ...draft, fine_amount: e.target.value })} /></div>
            <div className="field"><label>New total</label><input readOnly value={(draftTotal + n(draft.fine_amount)).toFixed(2)} /></div>
          </div>
          {inv.paid_amount > 0 && <p className="muted">Already paid: {inv.paid_amount.toFixed(2)} — the new total cannot be lower than that.</p>}
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={() => setEditMode(false)}>Discard</button>
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Correction'}</button>
          </div>
        </form>
      )}

      <h3 style={{ marginTop: 18 }}>Payments</h3>
      {inv.payments.length === 0 ? <p className="muted">No payments recorded.</p> : (
        <table>
          <thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Mode</th><th>Received by</th><th>Verified</th><th /></tr></thead>
          <tbody>
            {inv.payments.map((p) => (
              <tr key={p.id} className={p.voided_at ? 'row-struck' : ''}>
                <td>{p.receipt_number}</td>
                <td>{p.payment_date}{p.recorded_at && <div className="muted" style={{ fontSize: '0.72rem' }}>saved {fmtDateTime(p.recorded_at)}</div>}</td>
                <td>{p.amount.toFixed(2)}</td>
                <td>{p.payment_method}{p.payment_reference && <div className="muted" style={{ fontSize: '0.72rem' }}>{p.payment_reference}</div>}</td>
                <td>{p.received_by_name || '-'}</td>
                <td>{p.verified_at
                  ? <span title={p.verified_by_designation || ''}>✔ {p.verified_by_name}<div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDateTime(p.verified_at)}</div></span>
                  : (!p.voided_at && <button type="button" className="btn-ghost btn-sm" onClick={() => verify(p)}>Verify</button>)}</td>
                <td>
                  {p.voided_at ? <span className="muted" style={{ fontSize: '0.78rem' }}>Voided: {p.void_reason}</span> : (
                    <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => downloadFile(`/fees/payments/${p.id}/receipt.pdf`, `receipt-${p.receipt_number}.pdf`)}>Receipt</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditPayment({ ...p, notes: p.notes || '' })}>Edit</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setVoiding(p)}>Void</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Close</button></div>

      {editPayment && (
        <Modal title={`Correct Payment ${editPayment.receipt_number}`} onClose={() => setEditPayment(null)}>
          <form onSubmit={savePayment}>
            <div className="form-grid">
              <div className="field"><label>Amount</label><input type="number" min="0.01" step="0.01" required value={editPayment.amount} onChange={(e) => setEditPayment({ ...editPayment, amount: e.target.value })} /></div>
              <div className="field"><label>Date</label><DateInput required value={editPayment.payment_date} onChange={(e) => setEditPayment({ ...editPayment, payment_date: e.target.value })} /></div>
            </div>
            <div className="field"><label>Method</label>
              <select value={editPayment.payment_method} onChange={(e) => setEditPayment({ ...editPayment, payment_method: e.target.value })}>
                {modesWith(editPayment.payment_method).map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            {needsReference(editPayment.payment_method) && (
              <div className="field"><label>{referenceLabel(editPayment.payment_method)}</label><input value={editPayment.payment_reference || ''} onChange={(e) => setEditPayment({ ...editPayment, payment_reference: e.target.value })} /></div>
            )}
            <div className="field"><label>Notes</label><input value={editPayment.notes} onChange={(e) => setEditPayment({ ...editPayment, notes: e.target.value })} /></div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setEditPayment(null)}>Cancel</button>
              <button type="submit">Save Correction</button>
            </div>
          </form>
        </Modal>
      )}
      {voiding && (
        <ReasonModal title={`Void payment ${voiding.receipt_number}?`} message={`${voiding.amount.toFixed(2)} on ${voiding.payment_date}. The payment stays on record, crossed out, and the invoice balance goes back up.`}
          confirmLabel="Void Payment" suggestions={['Entered twice', 'Wrong student', 'Cheque bounced']} onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
      {cancelling && (
        <ReasonModal title={`Cancel invoice ${inv.invoice_number}?`} message="The invoice keeps its number for the record but no longer counts as money owed. You can restore it later."
          confirmLabel="Cancel Invoice" suggestions={['Created by mistake', 'Duplicate invoice', 'Student left']} onConfirm={doCancel} onClose={() => setCancelling(false)} />
      )}
      {showHistory && <HistoryModal entityType="fee_invoice" entityId={inv.id} title={`History — ${inv.invoice_number}`} onClose={() => setShowHistory(false)} />}
    </Modal>
  );
}
