import { forwardRef } from 'react';
import { useSchoolInfo } from './PaperView';

const CSS = `.ps{font-family:Segoe UI,Arial,sans-serif;color:#111} .ps h1{font-size:20px;color:#1d4ed8;margin:0;text-align:center}
.ps h2{font-size:15px;margin:4px 0 2px;text-align:center} .ps .contact{text-align:center;color:#555;font-size:10.5px} .ps .meta{text-align:center;color:#555;font-size:11px;margin-bottom:10px}
.ps table{width:100%;border-collapse:collapse;font-size:11px} .ps th,.ps td{border:1px solid #c7ccd6;padding:4px 6px;text-align:left}
.ps th{background:#eef2f9} .ps .head{display:flex;align-items:center;gap:10px;border-bottom:2px solid #1d4ed8;padding-bottom:6px;margin-bottom:6px}
.ps .head img{width:52px;height:52px;object-fit:contain} .ps .sign{display:flex;justify-content:space-between;margin-top:40px;font-size:11px}
.ps .sign span{border-top:1px solid #555;padding-top:3px;min-width:160px;text-align:center}`;

// A hidden, self-styled copy of a table with the school letterhead, for
// printElement(). columns: [{ key, label }], rows: [{ ...values }]
const PrintSheet = forwardRef(function PrintSheet({ title, meta, columns, rows, signatures = [] }, ref) {
  const school = useSchoolInfo();
  return (
    <div style={{ display: 'none' }}>
      <div ref={ref}>
        <style>{CSS}</style>
        <div className="ps">
          <div className="head">{school.logo && <img src={school.logo} alt="" />}<div style={{ flex: 1 }}><h1>{school.name}</h1>{school.contact && <div className="contact">{school.contact}</div>}<h2>{title}</h2></div></div>
          <div className="meta">{[meta, `Printed ${new Date().toLocaleString()}`].filter(Boolean).join('  ·  ')}</div>
          <table>
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key}>{r[c.key] ?? ''}</td>)}</tr>)}</tbody>
          </table>
          {signatures.length > 0 && <div className="sign">{signatures.map((s) => <span key={s}>{s}</span>)}</div>}
        </div>
      </div>
    </div>
  );
});

export default PrintSheet;
