import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import Modal from '../components/Modal';
import IconButton from '../components/IconButton';
import Badge from '../components/Badge';
import { todayStr } from '../utils/useRefs';
import DateInput from '../components/DateInput';

const KIND_LABEL = { In: 'Stock in', Out: 'Issued out', Adjust: 'Stock count' };

export default function InventoryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('inventory', 'manage');
  const [reload, setReload] = useState(0);
  const [moving, setMoving] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [items, setItems] = useState([]);

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  const low = items.filter((i) => i.low_stock).length;
  const value = items.reduce((s, i) => s + i.quantity * (i.unit_cost || 0), 0);

  async function move(e) {
    e.preventDefault();
    try {
      const res = await api.post(`/inventory/items/${moving.item.id}/moves`, { kind: moving.kind, quantity: Number(moving.quantity), moved_on: moving.moved_on, party: moving.party, notes: moving.notes });
      toast.success(`Saved — now ${res.balance} ${moving.item.unit || ''} in stock`);
      setMoving(null);
      setReload((r) => r + 1);
    } catch (err) { toast.error(err.message); }
  }

  const start = (item, kind) => setMoving({ item, kind, quantity: kind === 'Adjust' ? item.quantity : '', moved_on: todayStr(), party: '', notes: '' });

  return (
    <div>
      <div className="page-header"><h2>Inventory / Store</h2></div>
      <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Items</span><span className="stat-value">{items.length}</span></div>
        <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Low stock</span><span className="stat-value" style={low ? { color: 'var(--danger)' } : undefined}>{low}</span></div>
        <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Stock value</span><span className="stat-value">{value.toFixed(0)}</span></div>
      </div>
      <CrudManager
        endpoint="/inventory/items"
        noun="item"
        addLabel="Add Item"
        canManage={canManage}
        reloadKey={reload}
        onLoaded={setItems}
        fields={[
          { key: 'name', label: 'Item name', required: true, placeholder: 'e.g. Whiteboard marker (blue)' },
          { key: 'category', label: 'Category', list: 'inv-cats', placeholder: 'e.g. Stationery, Furniture, Lab, Sports' },
          { key: 'opening_stock', label: 'Opening stock (how many you have now)', type: 'number', min: 0, default: 0, show: (f) => !f.id },
          { key: 'unit', label: 'Unit (word, not a number)', default: 'pcs', placeholder: 'pcs, box, ream, set…' },
          { key: 'location', label: 'Location', placeholder: 'e.g. Store room, Lab 1' },
          { key: 'min_quantity', label: 'Alert when stock falls to', type: 'number', min: 0, default: 0 },
          { key: 'unit_cost', label: 'Cost per unit', type: 'number', min: 0 }
        ]}
        filters={[
          { key: 'category', label: 'All categories', type: 'select', options: categories },
          { key: 'search', label: 'Search…' },
          { key: 'low', label: 'Low stock only', type: 'checkbox' }
        ]}
        toolbar={<datalist id="inv-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>}
        rowClass={(r) => (r.low_stock ? 'row-low' : '')}
        columns={[
          { key: 'name', label: 'Item', render: (r) => <b dir="auto">{r.name}</b> },
          { key: 'category', label: 'Category' },
          { key: 'location', label: 'Location' },
          { key: 'quantity', label: 'In stock', render: (r) => <>{r.quantity} {r.unit} {r.low_stock ? <Badge variant="danger">LOW</Badge> : null}</> },
          { key: 'min_quantity', label: 'Alert at' },
          { key: 'last_moved', label: 'Last change', render: (r) => r.last_moved || '—' }
        ]}
        rowActions={(r) => (
          <>
            {canManage && <IconButton icon="plus" tone="success" label="Stock in (purchase / received)" onClick={() => start(r, 'In')} />}
            {canManage && <IconButton icon="send" tone="primary" label="Issue out" onClick={() => start(r, 'Out')} />}
            {canManage && <IconButton icon="restore" tone="default" label="Stock count (set actual quantity)" onClick={() => start(r, 'Adjust')} />}
            <IconButton icon="history" tone="default" label="Movement history" onClick={() => setHistoryFor(r)} />
          </>
        )}
        toPayload={(b) => ({ ...b, opening_stock: Number(b.opening_stock || 0), min_quantity: Number(b.min_quantity || 0), unit_cost: b.unit_cost === null ? null : Number(b.unit_cost) })}
        emptyMessage="No items yet. Add items, then record stock in / issue out."
        describe={(r) => r.name}
      />

      {moving && (
        <Modal title={`${KIND_LABEL[moving.kind]} — ${moving.item.name}`} onClose={() => setMoving(null)}>
          <form onSubmit={move}>
            <p className="muted" style={{ marginTop: 0 }}>In stock now: <b>{moving.item.quantity} {moving.item.unit}</b></p>
            <div className="form-grid">
              <div className="field"><label>{moving.kind === 'Adjust' ? 'Actual quantity counted' : 'Quantity'}</label><input type="number" min="0" step="any" required value={moving.quantity} onChange={(e) => setMoving({ ...moving, quantity: e.target.value })} /></div>
              <div className="field"><label>Date</label><DateInput value={moving.moved_on} onChange={(e) => setMoving({ ...moving, moved_on: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>{moving.kind === 'In' ? 'Supplier / received from' : moving.kind === 'Out' ? 'Issued to (person / class / department)' : 'Counted by'}</label><input value={moving.party} onChange={(e) => setMoving({ ...moving, party: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Notes</label><input value={moving.notes} onChange={(e) => setMoving({ ...moving, notes: e.target.value })} /></div>
            </div>
            <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setMoving(null)}>Cancel</button><button type="submit">Save</button></div>
          </form>
        </Modal>
      )}
      {historyFor && <MoveHistory item={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function MoveHistory({ item, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/inventory/moves?item_id=${item.id}`).then(setRows).catch(() => setRows([])); }, [item.id]);
  return (
    <Modal title={`History — ${item.name}`} onClose={onClose} wide>
      {!rows ? <p className="muted">Loading…</p> : (
        <table>
          <thead><tr><th>Date</th><th>What</th><th>Qty</th><th>Balance</th><th>From / to</th><th>Notes</th><th>By</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}><td>{m.moved_on}</td><td>{KIND_LABEL[m.kind]}</td><td>{m.quantity > 0 && m.kind !== 'Out' ? '+' : m.kind === 'Out' ? '−' : ''}{Math.abs(m.quantity)}</td><td>{m.balance_after}</td><td>{m.party}</td><td>{m.notes}</td><td>{m.created_by_name}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No movements yet.</td></tr>}
          </tbody>
        </table>
      )}
      <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
