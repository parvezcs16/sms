const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_G = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN_G = /[A-Za-zÀ-ɏ]/g;

export const hasUrdu = (t) => ARABIC.test(String(t || ''));

// Right-to-left when the text has at least as many Urdu letters as English ones.
export function isRtl(t) {
  const s = String(t || '');
  const ar = (s.match(ARABIC_G) || []).length;
  const la = (s.match(LATIN_G) || []).length;
  return ar > 0 && ar >= la;
}

// Props for an element showing text that may be Urdu: correct direction,
// alignment and an Urdu (Nastaliq) font.
export function textProps(t) {
  if (!hasUrdu(t)) return {};
  return isRtl(t) ? { dir: 'rtl', lang: 'ur', className: 'urdu' } : { dir: 'auto', className: 'urdu-mix' };
}

export const URDU_OPTION_LABELS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و'];
