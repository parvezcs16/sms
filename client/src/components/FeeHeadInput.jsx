import { useId } from 'react';

// Same loose match as the server: "Transport" = "transport fee" = "TRANSPORT FEES".
export function headKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()
    .replace(/\s+(fee|fees)$/, '').replace(/\s+/g, '');
}

export function matchHead(heads, name) {
  const k = headKey(name);
  return k ? heads.find((h) => headKey(h.name) === k) || null : null;
}

// Pick a fee head from the list, or type a new one — a new name is saved as a
// fee head automatically when the form is saved, and offered next time.
export default function FeeHeadInput({ heads, value, onChange, required, autoFocus, compact }) {
  const id = useId();
  const typed = String(value || '').trim();
  const isNew = typed && !matchHead(heads, typed);
  return (
    <div style={{ position: 'relative' }}>
      <input list={id} required={required} autoFocus={autoFocus} autoComplete="off" value={value || ''}
        placeholder="Choose or type a new fee head" onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{heads.map((h) => <option key={h.id} value={h.name} />)}</datalist>
      {isNew && !compact && <span className="muted" style={{ fontSize: '0.75rem' }}>New — “{typed}” will be added as a fee head</span>}
      {isNew && compact && <span title={`“${typed}” will be added as a new fee head`} style={{ fontSize: '0.7rem', color: 'var(--success, #16a34a)' }}>new</span>}
    </div>
  );
}
