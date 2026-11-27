// Printed documents show dates as DD-MM-YYYY while the database keeps
// YYYY-MM-DD. dmyDoc() makes a PDFKit document rewrite dates in every text
// it prints (and measures), so each PDF does not have to format them itself.
const ISO_DATE = /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b(?!-)/g;

function toDmy(v) {
  if (typeof v !== 'string' || v.indexOf('-') < 0) return v;
  return v.replace(ISO_DATE, (_, y, m, d) => `${d}-${m}-${y}`);
}

function dmyDoc(doc) {
  for (const fn of ['text', 'widthOfString', 'heightOfString']) {
    const orig = doc[fn];
    doc[fn] = function patched(t, ...rest) { return orig.call(this, typeof t === 'string' ? toDmy(t) : t, ...rest); };
  }
  return doc;
}

module.exports = { toDmy, dmyDoc };
