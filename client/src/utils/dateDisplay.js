// Dates are stored and sent as YYYY-MM-DD (sorting, date inputs, backups),
// but the school reads them as DD-MM-YYYY. This rewrites every date shown on
// screen, wherever it is rendered, without touching what is saved.
// Inputs, textareas and anything marked data-raw-date keep the raw value.

const ISO_DATE = /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b(?!-)/g;
const SKIP = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'OPTION', 'CODE', 'PRE']);

export function toDmy(text) {
  if (typeof text !== 'string' || text.indexOf('-') < 0) return text;
  return text.replace(ISO_DATE, (_, y, m, d) => `${d}-${m}-${y}`);
}

// "2026-11-27" or a Date → "27-11-2026" (for code that builds strings itself).
export function fmtDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(v.getDate())}-${pad(v.getMonth() + 1)}-${v.getFullYear()}`;
  }
  return toDmy(String(v));
}

function skipped(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable || (el.dataset && 'rawDate' in el.dataset)) return true;
  }
  return false;
}

function fixText(node) {
  const v = node.nodeValue;
  if (!v || v.length < 10 || v.indexOf('-') < 0) return;
  const next = toDmy(v);
  if (next !== v && !skipped(node)) node.nodeValue = next;
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) { fixText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.tagName)) return;
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) fixText(n);
  // Tooltips too (e.g. title="2026-11-27").
  if (root.title) { const t = toDmy(root.title); if (t !== root.title) root.title = t; }
}

export function installDateDisplay(root = document.body) {
  walk(root);
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  return () => obs.disconnect();
}
