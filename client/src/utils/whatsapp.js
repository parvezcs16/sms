// Opens a WhatsApp chat with a parent, with a ready-written message. Works on
// any PC or phone that has WhatsApp (desktop app or WhatsApp Web) — no linking
// needed. For sending the PDF itself automatically, the school links its
// WhatsApp number in Settings.
export function waNumber(raw, countryCode = '') {
  if (!raw) return '';
  const s = String(raw).trim();
  let digits = s.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (s.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  const cc = String(countryCode || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0') && cc) digits = cc + digits.slice(1);
  return digits;
}

export function openWhatsApp(phone, text, countryCode) {
  const n = waNumber(phone, countryCode);
  const url = `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}
