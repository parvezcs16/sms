import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import HistoryModal from '../components/HistoryModal';
import ReasonModal from '../components/ReasonModal';
import { localDateStr } from '../utils/date';
import IconButton from '../components/IconButton';
import DateInput from '../components/DateInput';

const emptyForm = { category_id: '', expense_date: '', amount: '', paid_to: '', payment_method: 'Cash', notes: '' };

export default function ExpensesPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [newCategory, setNewCategory] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [history, setHistory] = useState(null);

  async function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (showDeleted) params.set('include_deleted', 'true');
    try {
      setRows(await api.get(`/expenses?${params.toString()}`));
      setSummary(await api.get('/expenses/summary'));
    } catch (err) {
      toast.error(err.message);
    }
  }
  async function loadCategories() { setCategories(await api.get('/expenses/categories')); }

  useEffect(() => { load(); }, [from, to, showDeleted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCategories(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, expense_date: localDateStr() });
    setFormOpen(true);
  }

  function openEdit(r) {
    setEditingId(r.id);
    setForm({
      category_id: String(r.category_id), expense_date: r.expense_date, amount: String(r.amount),
      paid_to: r.paid_to || '', payment_method: r.payment_method || 'Cash', notes: r.notes || ''
    });
    setFormOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (editingId) {
        await api.put(`/expenses/${editingId}`, payload);
        toast.success('Expense corrected — the change is kept in its history');
      } else {
        await api.post('/expenses', payload);
        toast.success('Expense recorded');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function confirmDelete(reason) {
    try {
      await api.del(`/expenses/${deleting.id}?reason=${encodeURIComponent(reason)}`);
      toast.success('Expense deleted — it no longer counts in totals but stays under "Show deleted"');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function restore(id) {
    try {
      await api.post(`/expenses/${id}/restore`, {});
      toast.success('Expense restored');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitCategory(e) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      await api.post('/expenses/categories', { name: newCategory });
      setNewCategory('');
      loadCategories();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveRename(e) {
    e.preventDefault();
    try {
      await api.put(`/expenses/categories/${renaming.id}`, { name: renaming.name });
      setRenaming(null);
      loadCategories();
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Daily Expenses</h2>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={() => downloadFile(`/expenses/report?format=excel&from=${from}&to=${to}`, 'expense-report.xlsx')}>Export Excel</button>
          <button type="button" className="btn-secondary" onClick={() => downloadFile(`/expenses/report?format=pdf&from=${from}&to=${to}`, 'expense-report.pdf')}>Export PDF</button>
          <button type="button" onClick={openCreate}>+ Record Expense</button>
        </div>
      </div>

      {summary && (
        <div className="grid">
          <StatCard label="Today" value={summary.todayTotal.toFixed(2)} />
          <StatCard label="This Month" value={summary.monthTotal.toFixed(2)} />
          {summary.byCategory.filter((c) => c.total > 0).slice(0, 4).map((c) => (
            <StatCard key={c.category} label={c.category} value={c.total.toFixed(2)} sub="this month" />
          ))}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label>From</label><DateInput value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><DateInput value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <label className="row" style={{ margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted
          </label>
        </div>
        <table>
          <thead><tr><th>Expense No</th><th>Date</th><th>Category</th><th>Paid To</th><th>Amount</th><th>Method</th><th>Recorded by</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.deleted_at ? 'row-struck' : ''}>
                <td>{r.expense_number}{r.edit_count > 0 && <span className="edited-tag" title="This expense was corrected — see History">EDITED</span>}</td>
                <td>{r.expense_date}</td><td>{r.category_name}</td><td>{r.paid_to || '-'}</td>
                <td>{r.amount.toFixed(2)}</td><td>{r.payment_method}</td>
                <td>{r.recorded_by_name || '-'}</td>
                <td>
                  <div className="actions-cell">
                    {r.deleted_at ? (
                      <>
                        <Badge>Deleted</Badge>
                        <span className="muted" style={{ fontSize: '0.75rem' }} title={r.delete_reason}>{r.delete_reason}</span>
                        <IconButton icon="restore" tone="success" label="Restore" onClick={() => restore(r.id)} />
                      </>
                    ) : (
                      <>
                        <IconButton icon="edit" tone="primary" label="Edit" onClick={() => openEdit(r)} />
                        <IconButton icon="trash" tone="danger" label="Delete" onClick={() => setDeleting(r)} />
                      </>
                    )}
                    <IconButton icon="history" tone="default" label="History" onClick={() => setHistory(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No expenses recorded for this range.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Expense Categories</h3>
        <div className="row">
          {categories.map((c) => (renaming && renaming.id === c.id ? (
            <form key={c.id} className="inline-edit" onSubmit={saveRename}>
              <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
              <button type="submit" className="btn-sm">Save</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <button key={c.id} type="button" className="btn-ghost btn-sm" title="Click to rename" onClick={() => setRenaming({ id: c.id, name: c.name })}>{c.name} ✎</button>
          )))}
        </div>
        <form onSubmit={submitCategory} className="row" style={{ marginTop: 10 }}>
          <input placeholder="New category (e.g. Internet Bill)" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ maxWidth: 300 }} />
          <button type="submit" className="btn-secondary">Add Category</button>
        </form>
      </div>

      {formOpen && (
        <Modal title={editingId ? 'Correct Expense' : 'Record Expense'} onClose={() => setFormOpen(false)}>
          <form onSubmit={submit}>
            {editingId && <p className="muted">The original values are kept in this expense's History.</p>}
            <div className="field"><label>Category</label>
              <select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Select</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-grid">
              <div className="field"><label>Date</label><DateInput required value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div className="field"><label>Amount</label><input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Paid To</label><input value={form.paid_to} onChange={(e) => setForm({ ...form, paid_to: e.target.value })} /></div>
            <div className="field"><label>Payment Method</label>
              <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                <option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Online</option><option>Cheque</option>
              </select>
            </div>
            <div className="field"><label>Notes</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit">{editingId ? 'Save Correction' : 'Save Expense'}</button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <ReasonModal
          title={`Delete ${deleting.expense_number}?`}
          message={`${deleting.amount.toFixed(2)} — ${deleting.category_name}${deleting.paid_to ? `, paid to ${deleting.paid_to}` : ''}. It will stop counting in totals but is kept on record and can be restored.`}
          confirmLabel="Delete Expense"
          suggestions={['Entered twice', 'Wrong entry', 'Cancelled purchase']}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
      {history && <HistoryModal entityType="expense" entityId={history.id} title={`History — ${history.expense_number}`} onClose={() => setHistory(null)} />}
    </div>
  );
}
