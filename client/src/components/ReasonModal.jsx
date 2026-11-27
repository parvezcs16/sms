import { useState } from 'react';
import Modal from './Modal';

// Asks for a reason before a correction (cancel invoice, void payment, delete
// expense…). window.prompt() doesn't work inside the Electron desktop app.
export default function ReasonModal({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onClose, suggestions = [] }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {message && <p>{message}</p>}
        <div className="field">
          <label>Reason (kept in the history)</label>
          <input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice, wrong amount" />
        </div>
        {suggestions.length > 0 && (
          <div className="row" style={{ marginTop: -4 }}>
            {suggestions.map((s) => <button key={s} type="button" className="btn-ghost btn-sm" onClick={() => setReason(s)}>{s}</button>)}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Back</button>
          <button type="submit" className={danger ? 'btn-danger' : ''} disabled={busy || !reason.trim()}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
