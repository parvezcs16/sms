// Mixed English / Urdu text for PDFs.
//
// PDFKit shapes Arabic-script text correctly (joined letter forms) through
// fontkit, and lays a purely right-to-left run out in the right visual order —
// but it has no bidi algorithm, so a line that mixes Urdu with English words or
// numbers comes out scrambled. drawMixed() does the small part of bidi a
// question paper needs: it wraps the text itself, splits each line into
// same-direction runs, and places the runs right-to-left (Urdu paragraph) or
// left-to-right (English paragraph).
//
// Urdu needs a font that has the Urdu letters; the standard PDF fonts
// (Helvetica) have none. We use one already installed on the server PC
// (Arial / Segoe UI / Tahoma on Windows), so nothing extra has to be shipped.
const fs = require('fs');
const path = require('path');

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_G = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_G = /[A-Za-z\u00C0-\u024F]/g;
const LTR_RE = /[A-Za-z0-9\u00C0-\u024F]/;

function hasUrdu(text) {
  return ARABIC_RE.test(String(text || ''));
}

// A paragraph reads right-to-left when it has more Urdu letters than English ones.
function isRtl(text) {
  const s = String(text || '');
  const ar = (s.match(ARABIC_G) || []).length;
  const la = (s.match(LATIN_G) || []).length;
  return ar > 0 && ar >= la;
}

const FONT_DIRS = [
  process.env.SMS_URDU_FONT_DIR,
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts'),
  'C:\\Windows\\Fonts',
  '/usr/share/fonts/truetype/dejavu',
  '/usr/share/fonts/truetype/noto',
  '/Library/Fonts',
  '/System/Library/Fonts/Supplemental'
].filter(Boolean);
const REGULAR = ['NotoNaskhArabic-Regular.ttf', 'arial.ttf', 'Arial.ttf', 'segoeui.ttf', 'tahoma.ttf', 'DejaVuSans.ttf'];
const BOLD = ['NotoNaskhArabic-Bold.ttf', 'arialbd.ttf', 'Arial Bold.ttf', 'segoeuib.ttf', 'tahomabd.ttf', 'DejaVuSans-Bold.ttf'];

function findFont(names) {
  for (const dir of FONT_DIRS) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
    }
  }
  return null;
}

let cached;
function urduFonts() {
  if (cached === undefined) {
    const regular = findFont(REGULAR);
    cached = regular ? { regular, bold: findFont(BOLD) || regular } : null;
  }
  return cached;
}

// Registers the Urdu-capable fonts on a document (once) and returns the font
// names to use: { latin, latinBold, urdu, urduBold }.
function fontsFor(doc) {
  if (!doc._mixedFonts) {
    const f = urduFonts();
    if (f) {
      try {
        doc.registerFont('Mixed-Urdu', f.regular);
        doc.registerFont('Mixed-UrduBold', f.bold);
        doc._mixedFonts = { latin: 'Helvetica', latinBold: 'Helvetica-Bold', urdu: 'Mixed-Urdu', urduBold: 'Mixed-UrduBold' };
      } catch {
        doc._mixedFonts = null;
      }
    }
    if (!doc._mixedFonts) doc._mixedFonts = { latin: 'Helvetica', latinBold: 'Helvetica-Bold', urdu: 'Helvetica', urduBold: 'Helvetica-Bold' };
  }
  return doc._mixedFonts;
}

// Multi-digit numbers inside an Urdu run must survive the run being reversed.
// Brackets are mirrored too (the run is reversed glyph by glyph, without the
// mirroring a full bidi engine would do).
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
function protectNumbers(run) {
  return run.replace(/[()[\]{}<>«»]/g, (c) => MIRROR[c]).replace(/[0-9\u0660-\u0669\u06F0-\u06F9][0-9\u0660-\u0669\u06F0-\u06F9.,:/]*[0-9\u0660-\u0669\u06F0-\u06F9]/g, (m) => [...m].reverse().join(''));
}

// Passing the Arabic shaping features explicitly matters: with PDFKit's default
// set, spaces and end punctuation inside an Urdu run land in the wrong place.
const URDU_FEATURES = ['ccmp', 'locl', 'isol', 'init', 'medi', 'fina', 'rlig', 'liga', 'calt', 'mark', 'mkmk', 'kern'];

function wordDir(w) {
  if (ARABIC_RE.test(w)) return 'R';
  if (LTR_RE.test(w)) return 'L';
  return 'N';
}

/**
 * Draws wrapped mixed-direction text and returns the y below it.
 * opts: { x, y, width, size, bold, rtl (auto when omitted), align ('start'|'center'), color, lineGap }
 */
function drawMixed(doc, text, opts = {}) {
  const fonts = fontsFor(doc);
  const x = opts.x ?? doc.page.margins.left;
  const width = opts.width ?? (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const size = opts.size || 11;
  const str = String(text ?? '');
  const rtl = opts.rtl ?? isRtl(str);
  const lineHeight = size * (hasUrdu(str) ? 1.75 : 1.35) + (opts.lineGap || 0);
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  let y = opts.y ?? doc.y;

  const fontOf = (dir) => {
    const urdu = dir === 'R' || (rtl && fonts.urdu !== 'Helvetica');
    if (urdu) return opts.bold ? fonts.urduBold : fonts.urdu;
    return opts.bold ? fonts.latinBold : fonts.latin;
  };
  const measure = (s, dir) => doc.font(fontOf(dir)).fontSize(size).widthOfString(s, dir === 'R' ? { features: URDU_FEATURES } : {});

  doc.fillColor(opts.color || '#000');
  for (const para of str.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { y += lineHeight * 0.6; continue; }
    const lines = [];
    let cur = [];
    let curW = 0;
    for (const w of words) {
      const dir = wordDir(w);
      const ww = measure(w, dir);
      const sp = measure(' ', dir);
      if (cur.length && curW + sp + ww > width) {
        lines.push(cur);
        cur = [];
        curW = 0;
      }
      curW += (cur.length ? sp : 0) + ww;
      cur.push({ w, dir });
    }
    if (cur.length) lines.push(cur);

    for (const line of lines) {
      if (y + lineHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      // Group the words into runs of one direction; neutral words (dashes,
      // symbols) join the run they sit in, or the paragraph direction.
      const runs = [];
      for (const tok of line) {
        const last = runs[runs.length - 1];
        const dir = tok.dir === 'N' ? (last ? last.dir : (rtl ? 'R' : 'L')) : tok.dir;
        if (last && last.dir === dir) last.words.push(tok.w);
        else runs.push({ dir, words: [tok.w] });
      }
      const placed = runs.map((r) => {
        const s = r.words.join(' ');
        return { ...r, s, width: measure(s, r.dir), space: measure(' ', r.dir) };
      });
      const total = placed.reduce((sum, r, i) => sum + r.width + (i ? r.space : 0), 0);
      const offset = opts.align === 'center' ? Math.max(0, (width - total) / 2) : 0;
      if (rtl) {
        let cursor = x + width - offset;
        for (const r of placed) {
          cursor -= r.width;
          doc.font(fontOf(r.dir)).fontSize(size).text(r.dir === 'R' ? protectNumbers(r.s) : r.s, cursor, y + (r.dir === 'R' ? 0 : size * 0.12), { lineBreak: false, ...(r.dir === 'R' ? { features: URDU_FEATURES } : {}) });
          cursor -= r.space;
        }
      } else {
        let cursor = x + offset;
        for (const r of placed) {
          doc.font(fontOf(r.dir)).fontSize(size).text(r.dir === 'R' ? protectNumbers(r.s) : r.s, cursor, y, { lineBreak: false, ...(r.dir === 'R' ? { features: URDU_FEATURES } : {}) });
          cursor += r.width + r.space;
        }
      }
      y += lineHeight;
    }
  }
  doc.x = doc.page.margins.left;
  doc.y = y;
  return y;
}

module.exports = { drawMixed, hasUrdu, isRtl, urduFonts };
