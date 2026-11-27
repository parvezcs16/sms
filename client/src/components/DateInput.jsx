import { useEffect, useRef, useState } from 'react';

// A date field that shows and accepts DD-MM-YYYY while keeping the value the
// rest of the app uses (YYYY-MM-DD) — a drop-in for <input type="date">:
// same value / onChange(e.target.value) / min / max / required props.
// Typing "16022015" becomes 16-02-2015; 16/02/2015 also works. The 📅 button
// opens the normal calendar.

const pad = (n) => String(n).padStart(2, '0');

export function isoToDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// "16-02-2015" / "16/2/2015" / "16.02.2015" → "2015-02-16"; null if not a real date.
export function dmyToIso(text) {
  const m = /^\s*(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})\s*$/.exec(String(text || ''));
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Digits typed in a row get their dashes: 1602 → 16-02, 16022015 → 16-02-2015.
function autoDash(input) {
  const raw = input.replace(/[/.\s]/g, '-').replace(/[^\d-]/g, '').replace(/-{2,}/g, '-');
  if (raw.includes('-')) {
    // Day and month may be typed as one digit (5-3-1990); the next dash is
    // still added after two digits of the month.
    const [d, m = '', ...rest] = raw.split('-');
    const tail = rest.join('');
    if (raw.split('-').length === 2) {
      if (m.length > 2) return `${d.slice(0, 2)}-${m.slice(0, 2)}-${m.slice(2, 6)}`;
      return `${d.slice(0, 2)}-${m}`;
    }
    return `${d.slice(0, 2)}-${m.slice(0, 2)}-${tail.slice(0, 4)}`;
  }
  const digits = raw.slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

export default function DateInput({ value, onChange, min, max, required, disabled, title, placeholder = 'dd-mm-yyyy', style, className, id, name, autoFocus }) {
  const [text, setText] = useState(() => isoToDmy(value));
  const [editing, setEditing] = useState(false);
  const textRef = useRef(null);
  const pickerRef = useRef(null);

  // Follow the value when it changes from outside (e.g. a form reset).
  useEffect(() => { if (!editing) setText(isoToDmy(value)); }, [value, editing]);

  const emit = (iso) => { if (onChange) onChange({ target: { value: iso, name, type: 'date' }, currentTarget: { value: iso, name } }); };

  function check(iso, shown) {
    const el = textRef.current;
    if (!el) return;
    let msg = '';
    if (shown && !iso) msg = 'Enter the date as dd-mm-yyyy, e.g. 16-02-2015';
    else if (iso && min && iso < min) msg = `The date cannot be before ${isoToDmy(min)}`;
    else if (iso && max && iso > max) msg = `The date cannot be after ${isoToDmy(max)}`;
    el.setCustomValidity(msg);
  }

  function onType(e) {
    const next = autoDash(e.target.value);
    setText(next);
    if (!next.trim()) { check('', ''); if (value) emit(''); return; }
    const iso = dmyToIso(next);
    check(iso, next);
    if (iso && iso !== value) emit(iso);
  }

  function onBlur() {
    setEditing(false);
    const iso = dmyToIso(text);
    if (text.trim() && !iso) return; // keep the half-typed text so the error is shown on save
    setText(isoToDmy(iso || value));
  }

  function openCalendar() {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* older browser */ }
    el.focus(); el.click();
  }

  useEffect(() => { check(dmyToIso(text), text); }); // keep min/max messages current

  return (
    <span className={`date-input${disabled ? ' is-disabled' : ''}`} style={style}>
      <input
        ref={textRef} id={id} name={name} type="text" inputMode="numeric" autoComplete="off" autoFocus={autoFocus}
        className={className} placeholder={placeholder} title={title || 'dd-mm-yyyy'} required={required} disabled={disabled}
        value={text} onFocus={() => setEditing(true)} onBlur={onBlur} onChange={onType} maxLength={10}
      />
      <button type="button" className="date-input-btn" tabIndex={-1} aria-label="Open calendar" title="Open calendar" disabled={disabled} onClick={openCalendar}>📅</button>
      <input
        ref={pickerRef} type="date" className="date-input-native" tabIndex={-1} aria-hidden="true"
        value={value || ''} min={min} max={max}
        onChange={(e) => { setEditing(false); setText(isoToDmy(e.target.value)); check(e.target.value, e.target.value); emit(e.target.value); }}
      />
    </span>
  );
}
