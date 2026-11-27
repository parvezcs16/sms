import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

// Settings → School Branding → Stamps. Four stamp slots, each filled by
// uploading a scan of the real stamp or by designing one here (drawn as SVG,
// saved as a transparent PNG). "Where to use" picks which stamp is printed on
// which document.

export const STAMP_LABELS = {
  official: { name: 'Official School Seal', hint: 'Round seal for certificates, result cards and notices' },
  principal: { name: 'Principal Stamp', hint: 'Signature stamp beside the Principal / approver' },
  paid: { name: 'PAID Stamp', hint: 'Printed on fee receipts' },
  approved: { name: 'Approved / Verified', hint: 'For payslips, forms and letters' }
};

const DOC_LABELS = {
  certificates: 'Certificates (awards, leaving, character…)',
  result_cards: 'Result cards',
  progress_reports: 'Progress reports',
  fee_receipts: 'Fee receipts',
  payslips: 'Salary payslips',
  notices: 'Printed notices'
};

const INKS = [
  { id: 'blue', label: 'Blue', color: '#1e3a8a' },
  { id: 'violet', label: 'Violet', color: '#5b21b6' },
  { id: 'red', label: 'Red', color: '#b91c1c' },
  { id: 'green', label: 'Green', color: '#166534' },
  { id: 'black', label: 'Black', color: '#1f2937' }
];

const SHAPES = [
  { id: 'round', label: 'Round seal' },
  { id: 'oval', label: 'Oval' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'rubber', label: 'Rubber word' }
];

// Sensible starting design for each slot.
const PRESETS = {
  official: { shape: 'round', ink: 'blue', center: '★ OFFICIAL ★', bottom: '' },
  principal: { shape: 'rect', ink: 'blue', center: 'PRINCIPAL', bottom: '' },
  paid: { shape: 'rubber', ink: 'red', center: 'PAID', bottom: '' },
  approved: { shape: 'oval', ink: 'green', center: 'APPROVED', bottom: '' }
};

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Shrink text so it fits a given length (rough Arial-bold width ≈ 0.64 em per char).
const fitSize = (text, length, max, min = 9) => Math.max(min, Math.min(max, length / (Math.max(1, String(text).length) * 0.66)));

// Returns a standalone SVG string (W×H) for the design.
export function stampSvg({ shape, ink, top, bottom, center, date }) {
  const c = (INKS.find((i) => i.id === ink) || INKS[0]).color;
  const font = "font-family='Arial, Helvetica, sans-serif' font-weight='700'";
  const T = esc(String(top || '').toUpperCase());
  const B = esc(String(bottom || '').toUpperCase());
  const C = esc(center || '');
  const D = esc(date || '');
  if (shape === 'round' || shape === 'oval') {
    const W = shape === 'round' ? 300 : 380;
    const H = shape === 'round' ? 300 : 260;
    const cx = W / 2; const cy = H / 2;
    const rx = W / 2 - 8; const ry = H / 2 - 8; // outer ring
    const band = 40;
    const tRx = rx - band + 5; const tRy = ry - band + 5; // top text baseline (glyphs grow outward)
    const bRx = rx - 13; const bRy = ry - 13; // bottom text baseline (glyphs grow inward)
    // Angles in degrees, counter-clockwise from 3 o'clock. Top text wraps well
    // past the sides so long school names stay readable.
    const A = B ? 220 : 280; const Ab = 100;
    const pt = (x, y, deg) => `${(cx + x * Math.cos(deg * Math.PI / 180)).toFixed(1)} ${(cy - y * Math.sin(deg * Math.PI / 180)).toFixed(1)}`;
    const topD = `M ${pt(tRx, tRy, 90 + A / 2)} A ${tRx} ${tRy} 0 ${A > 180 ? 1 : 0} 1 ${pt(tRx, tRy, 90 - A / 2)}`;
    const botD = `M ${pt(bRx, bRy, 270 - Ab / 2)} A ${bRx} ${bRy} 0 0 0 ${pt(bRx, bRy, 270 + Ab / 2)}`;
    const perim = Math.PI * (tRx + tRy);
    const topFs = fitSize(T, perim * (A / 360) * 0.9, 24);
    const botFs = fitSize(B, Math.PI * (bRx + bRy) * (Ab / 360) * 0.95, 18);
    const cFs = fitSize(C, (rx - band) * 1.6, shape === 'round' ? 30 : 34, 12);
    const sR = (rx - band / 2 - 4); const sRy = (ry - band / 2 - 4);
    const star = (deg) => { const [x, y] = pt(sR, sRy, deg).split(' '); return `<text x='${x}' y='${(+y + 6).toFixed(1)}' font-size='17' text-anchor='middle'>★</text>`; };
    return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>
<defs>
<path id='tp' d='${topD}'/>
<path id='bp' d='${botD}'/>
</defs>
<g fill='none' stroke='${c}'>
<ellipse cx='${cx}' cy='${cy}' rx='${rx}' ry='${ry}' stroke-width='6'/>
<ellipse cx='${cx}' cy='${cy}' rx='${rx - 9}' ry='${ry - 9}' stroke-width='1.6'/>
<ellipse cx='${cx}' cy='${cy}' rx='${rx - band}' ry='${ry - band}' stroke-width='3'/>
</g>
<g fill='${c}' ${font}>
<text font-size='${topFs}' letter-spacing='1.2'><textPath href='#tp' startOffset='50%' text-anchor='middle'>${T}</textPath></text>
${B ? `<text font-size='${botFs}' letter-spacing='1.2'><textPath href='#bp' startOffset='50%' text-anchor='middle'>${B}</textPath></text>${star((90 + A / 2 + 270 - Ab / 2) / 2)}${star((90 - A / 2 + 360 + 270 + Ab / 2) / 2)}` : `<text x='${cx}' y='${cy + ry - 17}' font-size='17' text-anchor='middle'>★ ★ ★</text>`}
<text x='${cx}' y='${cy + cFs * 0.36 - (D ? 10 : 0)}' font-size='${cFs}' text-anchor='middle'>${C}</text>
${D ? `<text x='${cx}' y='${cy + 26}' font-size='15' text-anchor='middle' font-weight='400'>${D}</text>` : ''}
</g></svg>`;
  }
  if (shape === 'rect') {
    const W = 420; const H = 200;
    const tFs = fitSize(T, W - 50, 26, 11);
    const cFs = fitSize(C, W - 70, 40, 14);
    const lines = [B, D].filter(Boolean);
    return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>
<g fill='none' stroke='${c}'>
<rect x='5' y='5' width='${W - 10}' height='${H - 10}' rx='10' stroke-width='6'/>
<rect x='15' y='15' width='${W - 30}' height='${H - 30}' rx='5' stroke-width='1.6'/>
<line x1='34' y1='${62}' x2='${W - 34}' y2='${62}' stroke-width='2'/>
</g>
<g fill='${c}' ${font} text-anchor='middle'>
<text x='${W / 2}' y='${48}' font-size='${tFs}'>${T}</text>
<text x='${W / 2}' y='${lines.length ? 118 : 128}' font-size='${cFs}' letter-spacing='2'>${C}</text>
${lines.map((l, i) => `<text x='${W / 2}' y='${150 + i * 20}' font-size='16' font-weight='400'>${l}</text>`).join('')}
</g></svg>`;
  }
  // rubber: bold word in a thick frame, school name small underneath
  const W = 420; const H = 190;
  const cFs = fitSize(C, W - 70, 78, 18);
  const sub = [T, D].filter(Boolean).join('  ·  ');
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>
<g fill='none' stroke='${c}'>
<rect x='8' y='8' width='${W - 16}' height='${H - 16}' rx='16' stroke-width='9'/>
<rect x='22' y='22' width='${W - 44}' height='${H - 44}' rx='8' stroke-width='2'/>
</g>
<g fill='${c}' ${font} text-anchor='middle'>
<text x='${W / 2}' y='${sub ? 112 : 122}' font-size='${cFs}' letter-spacing='6'>${C}</text>
${sub ? `<text x='${W / 2}' y='${148}' font-size='${fitSize(sub, W - 70, 17, 9)}' font-weight='400'>${sub}</text>` : ''}
</g></svg>`;
}

const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// SVG → transparent PNG blob (PDFs can embed PNG, not SVG).
function svgToPng(svg, scale = 2.5) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the stamp image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not draw the stamp'));
    img.src = svgUrl(svg);
  });
}

function StampDesigner({ kind, schoolName, city, onSaved, onClose }) {
  const toast = useToast();
  const preset = PRESETS[kind];
  const [d, setD] = useState({ shape: preset.shape, ink: preset.ink, top: schoolName, bottom: city || preset.bottom, center: preset.center, date: '' });
  const [saving, setSaving] = useState(false);
  const svg = useMemo(() => stampSvg(d), [d]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const blob = await svgToPng(svg);
      const fd = new FormData();
      fd.append('stamp', blob, `stamp-${kind}.png`);
      await api.upload(`/settings/stamps/${kind}`, fd);
      toast.success(`${STAMP_LABELS[kind].name} saved`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stamp-designer">
      <div className="stamp-designer-head">
        <b>Design: {STAMP_LABELS[kind].name}</b>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="stamp-designer-body">
        <div className="stamp-designer-form">
          <div className="field"><label>Shape</label>
            <div className="seg">{SHAPES.map((s) => <button key={s.id} type="button" className={d.shape === s.id ? 'active' : ''} onClick={() => set('shape', s.id)}>{s.label}</button>)}</div>
          </div>
          <div className="field"><label>Ink colour</label>
            <div className="ink-row">{INKS.map((i) => <button key={i.id} type="button" title={i.label} className={`ink ${d.ink === i.id ? 'on' : ''}`} style={{ background: i.color }} onClick={() => set('ink', i.id)} />)}</div>
          </div>
          <div className="field"><label>{d.shape === 'rubber' ? 'Small line (school name)' : d.shape === 'rect' ? 'Top line' : 'Text around the top'}</label><input value={d.top} onChange={(e) => set('top', e.target.value)} /></div>
          <div className="field"><label>{d.shape === 'rubber' ? 'Big word' : 'Centre text'}</label><input value={d.center} onChange={(e) => set('center', e.target.value)} placeholder="e.g. PRINCIPAL, PAID, ★ OFFICIAL ★" /></div>
          {d.shape !== 'rubber' && <div className="field"><label>{d.shape === 'rect' ? 'Bottom line' : 'Text around the bottom'} <span className="muted">(optional)</span></label><input value={d.bottom} onChange={(e) => set('bottom', e.target.value)} placeholder="e.g. city, Est. 1998" /></div>}
          <div className="field"><label>Extra line <span className="muted">(optional)</span></label><input value={d.date} onChange={(e) => set('date', e.target.value)} placeholder="e.g. Reg. No. 1234" /></div>
        </div>
        <div className="stamp-designer-preview">
          <img src={svgUrl(svg)} alt="Stamp preview" />
          <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Use as ${STAMP_LABELS[kind].name}`}</button>
        </div>
      </div>
    </div>
  );
}

export default function SchoolStamps({ schoolName, city }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [bust, setBust] = useState(Date.now());
  const [designing, setDesigning] = useState(null);
  const [usage, setUsage] = useState({});

  async function load() {
    const r = await api.get('/settings/stamps');
    setData(r);
    setUsage(r.usage);
    setBust(Date.now());
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(kind, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('stamp', file);
    try {
      await api.upload(`/settings/stamps/${kind}`, fd);
      toast.success('Stamp uploaded');
      load();
    } catch (err) { toast.error(err.message); }
  }
  async function remove(kind) {
    if (!window.confirm(`Remove the ${STAMP_LABELS[kind].name}?`)) return;
    try { await api.del(`/settings/stamps/${kind}`); toast.success('Stamp removed'); load(); } catch (err) { toast.error(err.message); }
  }
  async function saveUsage() {
    try { await api.put('/settings/stamps/usage', usage); toast.success('Stamp placement saved'); } catch (err) { toast.error(err.message); }
  }

  if (!data) return <p className="muted">Loading stamps…</p>;
  return (
    <div>
      <div className="stamp-grid">
        {data.kinds.map((k) => (
          <div key={k} className="stamp-slot">
            <div className="stamp-img">
              {data.stamps[k] ? <img src={`/uploads/${encodeURIComponent(data.stamps[k])}?v=${bust}`} alt={STAMP_LABELS[k].name} /> : <span className="muted">No stamp yet</span>}
            </div>
            <b>{STAMP_LABELS[k].name}</b>
            <span className="muted" style={{ fontSize: '0.76rem' }}>{STAMP_LABELS[k].hint}</span>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn-sm" onClick={() => setDesigning(k)}>✨ Generate</button>
              <label className="btn-secondary btn-sm file-btn">Upload<input type="file" accept="image/png,image/jpeg" onChange={(e) => { upload(k, e.target.files[0]); e.target.value = ''; }} /></label>
              {data.stamps[k] && <button type="button" className="btn-ghost btn-sm" onClick={() => remove(k)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>

      {designing && <StampDesigner key={designing} kind={designing} schoolName={schoolName} city={city} onClose={() => setDesigning(null)} onSaved={() => { setDesigning(null); load(); }} />}

      <h4 style={{ margin: '18px 0 6px' }}>Where to use each stamp</h4>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>The chosen stamp is printed next to the signature on that document. A document whose stamp has not been made yet simply prints without one.</p>
      <div className="stamp-usage">
        {data.docs.map((doc) => (
          <div key={doc} className="field">
            <label>{DOC_LABELS[doc] || doc}</label>
            <select value={usage[doc] || ''} onChange={(e) => setUsage({ ...usage, [doc]: e.target.value })}>
              <option value="">No stamp</option>
              {data.kinds.map((k) => <option key={k} value={k}>{STAMP_LABELS[k].name}{data.stamps[k] ? '' : ' (not made yet)'}</option>)}
            </select>
          </div>
        ))}
      </div>
      <button type="button" onClick={saveUsage}>Save stamp placement</button>
    </div>
  );
}
