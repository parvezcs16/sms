import { forwardRef, useEffect, useState } from 'react';
import { api } from '../api/client';
import { hasUrdu, isRtl, URDU_OPTION_LABELS } from '../utils/urdu';
import { BRAND } from '../brand';

let schoolCache = null;
export function useSchoolInfo() {
  const [info, setInfo] = useState(schoolCache || { name: '', logo: '', year: '' });
  useEffect(() => {
    if (schoolCache) return;
    api.get('/settings').then((s) => {
      schoolCache = { name: s.school_name || BRAND.fullName, logo: s.school_logo ? `/uploads/${s.school_logo}` : '', year: s.academic_year || '', contact: [String(s.address || s.school_address || '').replace(/\s*\n\s*/g, ', ').trim(), s.school_phone ? `Ph: ${s.school_phone}` : ''].filter(Boolean).join('  ·  ') };
      setInfo(schoolCache);
    }).catch(() => {});
  }, []);
  return info;
}

// Styles travel with the element so the printed copy (printElement) looks the
// same as the on-screen preview.
const PAPER_CSS = `
.pv { background:#fff; color:#111; font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.5; padding: 8px 4px; }
.pv .pv-head { display:flex; align-items:center; gap:12px; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
.pv .pv-head img { width:52px; height:52px; object-fit:contain; }
.pv .pv-school { flex:1; text-align:center; }
.pv .pv-school h1 { margin:0; font-size: 21px; color:#1d4ed8; }
.pv .pv-school h2 { margin:2px 0 0; font-size: 16px; }
.pv table.pv-info { width:100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 13px; }
.pv table.pv-info td { border:1px solid #c7ccd6; padding: 4px 8px; }
.pv table.pv-info td.k { font-weight:600; background:#f3f5fa; width: 16%; }
.pv .pv-instr { font-style: italic; margin: 4px 0 12px; }
.pv ol.pv-qs { list-style:none; margin:0; padding:0; }
.pv .pv-q { display:flex; gap:10px; margin: 0 0 12px; break-inside: avoid; page-break-inside: avoid; }
.pv .pv-num { font-weight:700; min-width: 34px; }
.pv .pv-body { flex:1; }
.pv .pv-marks { white-space:nowrap; color:#444; font-size: 12.5px; min-width: 64px; text-align:end; }
.pv .pv-opts { display:grid; grid-template-columns: 1fr 1fr; gap: 2px 20px; margin-top: 4px; }
.pv .pv-opts.one { grid-template-columns: 1fr; }
.pv [dir=rtl], .pv .pv-ur { font-family: 'Jameel Noori Nastaleeq', 'Noto Nastaliq Urdu', 'Urdu Typesetting', 'Segoe UI', Arial, sans-serif; font-size: 1.12em; line-height: 2; }
.pv .pv-q[dir=rtl] .pv-num, .pv .pv-q[dir=rtl] .pv-marks { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; line-height: 2.2; }
`;

const PaperView = forwardRef(function PaperView({ paper, questions }, ref) {
  const school = useSchoolInfo();
  const total = questions.reduce((s, q) => s + Number(q.marks_override || q.marks || 0), 0);
  return (
    <div className="pv" ref={ref}>
      <style>{PAPER_CSS}</style>
      <div className="pv-head">
        {school.logo ? <img src={school.logo} alt="" /> : <span style={{ width: 52 }} />}
        <div className="pv-school">
          <h1>{school.name}</h1>
          <h2 dir="auto" className={hasUrdu(paper.title) ? 'pv-ur' : ''}>{paper.title || 'Untitled paper'}</h2>
        </div>
        <span style={{ width: 52 }} />
      </div>
      <table className="pv-info"><tbody>
        <tr><td className="k">Class</td><td>{paper.class_name || '—'}</td><td className="k">Subject</td><td>{paper.subject_name || '—'}</td></tr>
        <tr><td className="k">Term</td><td>{paper.term || '—'}</td><td className="k">Total Marks</td><td>{total}</td></tr>
        <tr><td className="k">Duration</td><td>{paper.duration_minutes || 60} minutes</td><td className="k">Date</td><td>{paper.scheduled_date || '—'}</td></tr>
      </tbody></table>
      {paper.instructions && <div className="pv-instr" dir="auto">{hasUrdu(paper.instructions) ? paper.instructions : `Instructions: ${paper.instructions}`}</div>}
      <ol className="pv-qs">
        {questions.map((q, i) => {
          const rtl = isRtl(q.question_text);
          let options = [];
          if (q.question_type === 'MCQ') {
            try { options = (Array.isArray(q.options) ? q.options : JSON.parse(q.options_json || '[]')).filter(Boolean); } catch { options = []; }
          }
          const longOpt = options.some((o) => String(o).length > 32);
          return (
            <li key={q.id || i} className="pv-q" dir={rtl ? 'rtl' : 'ltr'}>
              <span className="pv-num">{rtl ? `${i + 1}.` : `Q${i + 1}.`}</span>
              <div className="pv-body">
                <div dir="auto">{q.question_text}</div>
                {options.length > 0 && (
                  <div className={`pv-opts${longOpt ? ' one' : ''}`}>
                    {options.map((o, oi) => {
                      const ortl = rtl || isRtl(o);
                      return <div key={oi} dir={ortl ? 'rtl' : 'ltr'}>{ortl ? `(${URDU_OPTION_LABELS[oi] || oi + 1})` : `${String.fromCharCode(97 + oi)})`} {o}</div>;
                    })}
                  </div>
                )}
              </div>
              <span className="pv-marks">[{q.marks_override || q.marks} marks]</span>
            </li>
          );
        })}
      </ol>
      {questions.length === 0 && <p style={{ color: '#888' }}>No questions selected yet.</p>}
    </div>
  );
});

export default PaperView;
