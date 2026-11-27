// Payment modes offered when recording fee payments and paying salaries.
export const PAYMENT_MODES = ['Cash', 'Online Transfer', 'Bank Deposit', 'Cheque', 'Card', 'Other'];

// Older records may hold a method that is no longer in the list (e.g. "Bank
// Transfer") — keep it selectable so editing never silently changes it.
export function modesWith(current) {
  return current && !PAYMENT_MODES.includes(current) ? [current, ...PAYMENT_MODES] : PAYMENT_MODES;
}

export const needsReference = (mode) => Boolean(mode) && mode !== 'Cash';

export function referenceLabel(mode) {
  if (mode === 'Cheque') return 'Cheque number';
  if (mode === 'Online Transfer' || mode === 'Bank Deposit') return 'Transaction / slip reference';
  return 'Reference (optional)';
}

// "2026-11-24 10:42:05" -> "24 Nov 2026, 10:42"
export function fmtDateTime(ts) {
  if (!ts) return '';
  const [d, t = ''] = String(ts).replace('T', ' ').split(' ');
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return ts;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(day)}-${pad(m)}-${y}${t ? ` ${t.slice(0, 5)}` : ''}`;
}
