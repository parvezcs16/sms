import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import IconButton from './IconButton';
import DateInput from './DateInput';

// A list + add/edit form for simple record types, driven by field and column
// definitions. Click a row (or the pencil) to edit; the bin removes.
//
// fields:  [{ key, label, type: text|textarea|number|date|time|select|tel|email, options, required, full, placeholder, default, show(form) }]
// columns: [{ key, label, render(row) }]
// filters: [{ key, label, type: select|text|date, options }]
function optionList(options) {
  return (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
}

export function FieldInput({ field, value, onChange }) {
  const common = { value: value ?? '', required: field.required, placeholder: field.placeholder, onChange: (e) => onChange(e.target.value) };
  if (field.type === 'textarea') return <textarea rows={field.rows || 3} dir="auto" {...common} />;
  if (field.type === 'select') {
    return (
      <select {...common}>
        {!field.noBlank && <option value="">{field.blankLabel || 'Select'}</option>}
        {optionList(field.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'date') return <DateInput {...common} min={field.min} max={field.max} />;
  const type = { number: 'number', date: 'date', time: 'time', tel: 'tel', email: 'email' }[field.type] || 'text';
  return <input type={type} step={field.step || (type === 'number' ? 'any' : undefined)} min={field.min} dir={type === 'text' ? 'auto' : undefined} list={field.list} {...common} />;
}

export function RecordForm({ fields, form, setForm }) {
  return (
    <div className="form-grid">
      {fields.filter((f) => !f.show || f.show(form)).map((f) => (
        <div key={f.key} className="field" style={f.full ? { gridColumn: '1 / -1' } : undefined}>
          <label>{f.label}{f.required ? ' *' : ''}</label>
          <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
          {f.hint && <span className="muted" style={{ fontSize: '0.75rem' }}>{f.hint}</span>}
        </div>
      ))}
    </div>
  );
}

export default function CrudManager({
  endpoint, fields, columns, filters = [], canManage, addLabel = 'Add', title, noun = 'record',
  rowActions, toolbar, reloadKey, emptyMessage = 'Nothing here yet.', toPayload, rowClass, initialFilters = {}, onLoaded, describe, onFilterChange
}) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilters);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = Object.entries(filter).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const data = await api.get(`${endpoint}${q ? `?${q}` : ''}`);
      setRows(data);
      if (onLoaded) onLoaded(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); if (onFilterChange) onFilterChange(filter); }, [endpoint, JSON.stringify(filter), reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function blank() {
    return Object.fromEntries(fields.map((f) => [f.key, typeof f.default === 'function' ? f.default(filter) : (f.default ?? '')]));
  }
  function edit(row) {
    setForm({ id: row.id, ...Object.fromEntries(fields.map((f) => [f.key, row[f.key] ?? ''])) });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { id, ...rest } = form;
      const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === '' ? null : v]));
      const payload = toPayload ? toPayload(body) : body;
      if (id) await api.put(`${endpoint}/${id}`, payload);
      else await api.post(endpoint, payload);
      toast.success(id ? 'Saved' : `${noun[0].toUpperCase()}${noun.slice(1)} added`);
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove this ${noun}${describe ? ` (${describe(row)})` : ''}?`)) return;
    try {
      await api.del(`${endpoint}/${row.id}`);
      toast.success('Removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 10px' }}>
        <div className="row filters" style={{ margin: 0 }}>
          {title && <h3 style={{ margin: '0 8px 0 0' }}>{title}</h3>}
          {filters.map((f) => (
            f.type === 'select' ? (
              <select key={f.key} value={filter[f.key] || ''} onChange={(e) => setFilter({ ...filter, [f.key]: e.target.value })} title={f.label}>
                <option value="">{f.label}</option>
                {optionList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label key={f.key} className="row" style={{ margin: 0, gap: 4, fontSize: '0.85rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(filter[f.key])} onChange={(e) => setFilter({ ...filter, [f.key]: e.target.checked ? '1' : '' })} /> {f.label}
              </label>
            ) : (
              f.type === 'date'
                ? <DateInput key={f.key} title={f.label} placeholder={f.label} style={{ width: 'auto' }} value={filter[f.key] || ''} onChange={(e) => setFilter({ ...filter, [f.key]: e.target.value })} />
                : <input key={f.key} type="text" dir="auto" placeholder={f.label} title={f.label} value={filter[f.key] || ''} onChange={(e) => setFilter({ ...filter, [f.key]: e.target.value })} />
            )
          ))}
        </div>
        <div className="row" style={{ margin: 0 }}>
          {toolbar}
          {canManage && <button type="button" onClick={() => setForm(blank())}>+ {addLabel}</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`${canManage ? 'row-selectable' : ''} ${rowClass ? rowClass(r) : ''}`} onClick={canManage ? () => edit(r) : undefined}>
                {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : (r[c.key] ?? '')}</td>)}
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="actions-cell">
                    {rowActions && rowActions(r, load)}
                    {canManage && <IconButton icon="edit" tone="primary" label="Edit" onClick={() => edit(r)} />}
                    {canManage && <IconButton icon="trash" tone="danger" label="Remove" onClick={() => remove(r)} />}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 1} className="muted">{emptyMessage}</td></tr>}
            {loading && rows.length === 0 && <tr><td colSpan={columns.length + 1} className="muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.id ? `Edit ${noun}` : addLabel} onClose={() => setForm(null)} wide={fields.length > 6}>
          <form onSubmit={save}>
            <RecordForm fields={fields} form={form} setForm={setForm} />
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
