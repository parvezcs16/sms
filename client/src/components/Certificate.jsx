// Printable certificate pages. Awards (position / appreciation / participation)
// are A4 landscape; school documents (leaving / provisional / character) are
// A4 portrait letterheads. Each has three looks: classic, royal, modern.
// All styling is inside the element so printElement() can print it alone.

export const AWARD_CATEGORIES = ['position', 'appreciation', 'participation'];
export const isAward = (category) => AWARD_CATEGORIES.includes(category);

export const TEMPLATE_INFO = {
  classic: { label: 'Classic Gold', note: 'Cream paper, double gold frame, serif type' },
  royal: { label: 'Royal Blue', note: 'Navy frame with gold lines and corner ribbons' },
  modern: { label: 'Modern', note: 'Clean white page with bold colour bands' }
};

const MEDAL = {
  '1st': { a: '#8a6a12', b: '#f3cf55', label: 'FIRST' },
  '2nd': { a: '#6b7280', b: '#e5e7eb', label: 'SECOND' },
  '3rd': { a: '#7c4a1e', b: '#d99a5b', label: 'THIRD' }
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ''}`;
  return `${words(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${words(n % 1000)}` : ''}`;
}
function ordinal(d) {
  if (d <= 20) return ORD[d];
  if (d === 30) return 'Thirtieth';
  return `${TENS[Math.floor(d / 10)]}-${ORD[d % 10]}`;
}
export function dateInWords(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const month = new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
  return `${ordinal(d)} ${month} ${words(y)}`;
}
// "5-A" -> "Class 5-A"; a class already named "Class 5" is left as it is.
export const classText = (label) => (label ? (/^(class|grade|kg|nursery|prep|play)/i.test(label) ? label : `Class ${label}`) : '');

export function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// he / she, his / her, S/O / D/O from the student's gender.
export function pronouns(gender) {
  const g = String(gender || '').toLowerCase();
  if (g.startsWith('f')) return { he: 'she', his: 'her', him: 'her', rel: 'D/O', He: 'She', His: 'Her' };
  if (g.startsWith('m')) return { he: 'he', his: 'his', him: 'him', rel: 'S/O', He: 'He', His: 'His' };
  return { he: 'the student', his: 'their', him: 'them', rel: 'S/O, D/O', He: 'The student', His: 'Their' };
}

const AWARD_TITLE = {
  position: ['Certificate', 'of Achievement'],
  appreciation: ['Certificate', 'of Appreciation'],
  participation: ['Certificate', 'of Participation']
};
const DOC_TITLE = { leaving: 'School Leaving Certificate', provisional: 'Provisional Certificate', character: 'Character Certificate' };

const CSS = `
.cert-root { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2430; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cert-page { position: relative; overflow: hidden; background: #fff; box-sizing: border-box; }
.cert-land { width: 297mm; height: 210mm; }
.cert-port { width: 210mm; height: 297mm; }
.cert-page * { box-sizing: border-box; }
.cert-serif { font-family: Georgia, 'Times New Roman', serif; }
.cert-script { font-family: 'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive; }
.cert-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.cert-logo { height: 22mm; width: auto; max-width: 40mm; object-fit: contain; }
.cert-school { font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.cert-small { font-size: 10pt; color: #5b6170; }
.cert-name { font-size: 36pt; line-height: 1.1; padding: 0 10mm 2mm; border-bottom: 1.2px solid currentColor; min-width: 130mm; }
.cert-body { font-size: 14.5pt; line-height: 1.65; max-width: 210mm; }
.cert-sigs { position: absolute; left: 0; right: 0; display: flex; justify-content: space-between; padding: 0 30mm; }
.cert-sig { width: 60mm; text-align: center; font-size: 10.5pt; }
.cert-sig span { display: block; border-top: 1px solid #333; padding-top: 1.5mm; }
.cert-no { position: absolute; font-size: 9pt; color: #555; }
.cert-medal { position: absolute; width: 34mm; height: 34mm; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; text-align: center; line-height: 1; box-shadow: 0 2mm 4mm rgba(0,0,0,.25); }
.cert-medal b { display: block; font-size: 20pt; }
.cert-medal small { font-size: 7pt; letter-spacing: .12em; }
.cert-medal::after { content: ''; position: absolute; inset: 2.2mm; border-radius: 50%; border: 1px dashed rgba(255,255,255,.7); }

/* classic */
.t-classic { background: #fdf8ea; }
.t-classic .frame1 { position: absolute; inset: 7mm; border: 2.5mm solid #b8902f; }
.t-classic .frame2 { position: absolute; inset: 12mm; border: .6mm solid #b8902f; }
.t-classic .corner { position: absolute; width: 16mm; height: 16mm; border: .8mm solid #b8902f; transform: rotate(45deg); background: #fdf8ea; }
.t-classic .ttl { color: #8a6a12; }
.t-classic .cert-name { color: #3d2f0a; }
/* royal */
.t-royal { background: #fff; }
.t-royal .frame1 { position: absolute; inset: 0; border: 9mm solid #13285e; }
.t-royal .frame2 { position: absolute; inset: 12mm; border: .8mm solid #c9a23a; }
.t-royal .ribbon { position: absolute; width: 70mm; height: 13mm; background: linear-gradient(90deg, #c9a23a, #ecd27a); transform: rotate(-45deg); }
.t-royal .ttl { color: #13285e; }
.t-royal .cert-name { color: #13285e; }
/* modern */
.t-modern { background: #fff; }
.t-modern .band { position: absolute; }
.t-modern .ttl { color: #0f5a57; }
.t-modern .cert-name { color: #0f3d3b; border-bottom-color: #19a39a; }

/* documents */
.doc-head { display: flex; align-items: center; gap: 6mm; padding-bottom: 4mm; }
.doc-head .cert-school { font-size: 19pt; line-height: 1.15; }
.doc-title { display: inline-block; font-size: 17pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2mm 9mm; margin: 6mm 0 3mm; }
.doc-meta { display: flex; justify-content: space-between; font-size: 10.5pt; margin: 3mm 0 5mm; }
.doc-text { font-size: 12.5pt; line-height: 1.85; text-align: justify; }
.doc-text b { border-bottom: 1px dotted #555; padding: 0 1mm; }
.doc-table { width: 100%; border-collapse: collapse; font-size: 11pt; margin: 4mm 0; }
.doc-table td { border: .3mm solid #9aa1ad; padding: 2.2mm 3mm; vertical-align: top; }
.doc-table td:first-child { width: 38%; font-weight: 600; background: rgba(0,0,0,.03); }
.doc-sigs { position: absolute; left: 20mm; right: 20mm; bottom: 26mm; display: flex; justify-content: space-between; align-items: flex-end; }
.doc-stamp { width: 30mm; height: 30mm; border-radius: 50%; border: .5mm dashed #9aa1ad; display: grid; place-items: center; font-size: 8pt; color: #9aa1ad; }
.d-classic { background: #fffdf6; }
.d-classic .dframe { position: absolute; inset: 8mm; border: 1.6mm double #b8902f; }
.d-classic .doc-title { color: #7a5c0e; border-top: .6mm solid #b8902f; border-bottom: .6mm solid #b8902f; }
.d-classic .doc-head { border-bottom: .6mm solid #b8902f; }
.d-royal .dtop { position: absolute; left: 0; right: 0; top: 0; height: 9mm; background: #13285e; border-bottom: 1.6mm solid #c9a23a; }
.d-royal .dbot { position: absolute; left: 0; right: 0; bottom: 0; height: 7mm; background: #13285e; border-top: 1.2mm solid #c9a23a; }
.d-royal .doc-title { background: #13285e; color: #fff; border-radius: 1mm; }
.d-royal .doc-head .cert-school { color: #13285e; }
.d-modern .dside { position: absolute; left: 0; top: 0; bottom: 0; width: 7mm; background: linear-gradient(180deg, #0f5a57, #19a39a); }
.d-modern .doc-title { color: #0f5a57; padding-left: 0; border-bottom: 1.2mm solid #19a39a; }
.d-modern .doc-head .cert-school { color: #0f3d3b; }
.cert-stamp-img { display: block; margin: 0 auto; width: 30mm; height: 30mm; object-fit: contain; transform: rotate(-8deg); opacity: .9; }
.cert-void { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.cert-void span { transform: rotate(-24deg); font-size: 60pt; font-weight: 900; color: rgba(220,38,38,.22); border: 2mm solid rgba(220,38,38,.22); padding: 2mm 10mm; }
`;

function Sig({ label }) {
  return <div className="cert-sig"><span>{label}</span></div>;
}

function AwardBody({ c, school, data }) {
  const p = pronouns(data.gender);
  if (c === 'position') {
    return <>for securing <b>{data.position} Position</b> in <b>{data.event || 'the Annual Examination'}</b>{data.session ? ` (${data.session})` : ''}. In recognition of {p.his} hard work, dedication and outstanding performance{data.remarks ? ` — ${data.remarks}` : ''}.</>;
  }
  if (c === 'appreciation') {
    return <>in appreciation of <b>{data.reason || 'excellent performance and dedication'}</b>{data.event ? ` in ${data.event}` : ''}. {school ? `${school} ` : 'We '}{school ? 'is' : 'are'} proud of {p.his} efforts and wish {p.him} continued success.</>;
  }
  return <>for taking part in <b>{data.event || 'the school event'}</b>{data.held_on ? ` held on ${fmtDate(data.held_on)}` : ''}{data.role ? ` as ${data.role}` : ''}. {p.His} enthusiasm and sportsmanship are highly appreciated.</>;
}

function Award({ cert, school }) {
  const { category: c, template: t, recipient_name: name, data = {} } = cert;
  const [t1, t2] = AWARD_TITLE[c];
  const p = pronouns(data.gender);
  const medal = c === 'position' ? MEDAL[data.position] || MEDAL['1st'] : null;
  const intro = c === 'position' ? 'This certificate is proudly presented to' : c === 'appreciation' ? 'This certificate is presented to' : 'This is to certify that';
  const who = [data.parent_name ? `${p.rel} ${data.parent_name}` : '', classText(data.class_label)].filter(Boolean).join(' · ');
  const color = { classic: '#8a6a12', royal: '#13285e', modern: '#0f5a57' }[t];

  return (
    <div className={`cert-page cert-land t-${t}`}>
      {t === 'classic' && <>
        <div className="frame1" /><div className="frame2" />
        {[[4, 4], [4, null], [null, 4], [null, null]].map(([top, left], i) => (
          <div key={i} className="corner" style={{ top: top != null ? '4mm' : undefined, bottom: top == null ? '4mm' : undefined, left: left != null ? '4mm' : undefined, right: left == null ? '4mm' : undefined }} />
        ))}
      </>}
      {t === 'royal' && <>
        <div className="frame1" /><div className="frame2" />
        <div className="ribbon" style={{ top: '14mm', left: '-14mm' }} />
        <div className="ribbon" style={{ bottom: '14mm', right: '-14mm' }} />
      </>}
      {t === 'modern' && <>
        <div className="band" style={{ top: 0, left: 0, width: '100%', height: '10mm', background: 'linear-gradient(90deg,#0f5a57,#19a39a 60%,#f2a81d)' }} />
        <div className="band" style={{ bottom: 0, left: 0, width: '100%', height: '6mm', background: 'linear-gradient(90deg,#f2a81d,#19a39a 40%,#0f5a57)' }} />
        <div className="band" style={{ top: '-40mm', right: '-40mm', width: '110mm', height: '110mm', borderRadius: '50%', background: 'rgba(25,163,154,.10)' }} />
        <div className="band" style={{ bottom: '-50mm', left: '-30mm', width: '110mm', height: '110mm', borderRadius: '50%', background: 'rgba(242,168,29,.12)' }} />
      </>}

      <div className="cert-center" style={{ padding: t === 'modern' ? '16mm 28mm 44mm' : '22mm 32mm 46mm', justifyContent: 'center' }}>
        {school.logo && <img className="cert-logo" src={school.logo} alt="" />}
        <div className="cert-school" style={{ fontSize: '15pt', marginTop: '2mm', color }}>{school.name}</div>
        {school.contact && <div className="cert-small">{school.contact}</div>}
        <div className={t === 'modern' ? '' : 'cert-serif'} style={{ marginTop: '5mm', lineHeight: 1 }}>
          <div className="ttl" style={{ fontSize: t === 'modern' ? '34pt' : '40pt', fontWeight: t === 'modern' ? 800 : 700, letterSpacing: t === 'modern' ? '.04em' : '.02em', textTransform: t === 'modern' ? 'uppercase' : 'none' }}>{t1}</div>
          <div className="ttl" style={{ fontSize: '17pt', letterSpacing: '.3em', textTransform: 'uppercase', marginTop: '2mm' }}>{t2}</div>
        </div>
        <div className="cert-small" style={{ marginTop: '6mm', fontSize: '11.5pt' }}>{intro}</div>
        <div className={`cert-name ${t === 'modern' ? '' : 'cert-script'}`} style={{ marginTop: '3mm', fontWeight: t === 'modern' ? 800 : 400 }}>{name}</div>
        {who && <div className="cert-small" style={{ marginTop: '2mm' }}>{who}</div>}
        <div className={`cert-body ${t === 'modern' ? '' : 'cert-serif'}`} style={{ marginTop: '4mm' }}>
          <AwardBody c={c} school={school.name} data={data} />
        </div>
      </div>

      {medal && (
        <div className="cert-medal" style={{ top: t === 'modern' ? '18mm' : '22mm', right: t === 'modern' ? '22mm' : '26mm', background: `radial-gradient(circle at 35% 30%, ${medal.b}, ${medal.a})` }}>
          <div><b>{data.position}</b><small>{medal.label}</small></div>
        </div>
      )}
      <div className="cert-sigs" style={{ bottom: t === 'royal' ? '22mm' : '24mm' }}>
        <Sig label={data.sig_left || 'Class Teacher'} />
        <div className="cert-sig" style={{ alignSelf: 'flex-end' }}>
          {school.stamp && <img className="cert-stamp-img" src={school.stamp} alt="School stamp" style={{ marginBottom: '1mm' }} />}
          <div className="cert-small">Date: {fmtDate(cert.issue_date)}</div>
        </div>
        <Sig label={data.sig_right || 'Principal'} />
      </div>
      <div className="cert-no" style={{ left: t === 'royal' ? '16mm' : '18mm', bottom: t === 'royal' ? '13.5mm' : '14.5mm' }}>No. {cert.certificate_number || 'DRAFT'}</div>
    </div>
  );
}

function Row({ k, v }) { return v ? <tr><td>{k}</td><td>{v}</td></tr> : null; }

function DocBody({ cert, school }) {
  const { category: c, recipient_name: name, data = {} } = cert;
  const p = pronouns(data.gender);
  const parent = data.parent_name || '________________';
  if (c === 'leaving') {
    return (
      <>
        <p className="doc-text">This is to certify that <b>{name}</b> {p.rel} <b>{parent}</b> was a bonafide student of this school.
          {` ${p.His}`} particulars, as recorded in the school admission register, are given below:</p>
        <table className="doc-table"><tbody>
          <Row k="Admission No." v={data.admission_number} />
          <Row k="Student's Name" v={name} />
          <Row k="Father's / Guardian's Name" v={data.parent_name} />
          <Row k="Date of Birth (figures)" v={fmtDate(data.date_of_birth)} />
          <Row k="Date of Birth (words)" v={dateInWords(data.date_of_birth)} />
          <Row k="Date of Admission" v={fmtDate(data.admission_date)} />
          <Row k="Class at time of Leaving" v={data.class_label} />
          <Row k="Date of Leaving" v={fmtDate(data.left_on)} />
          <Row k="Reason for Leaving" v={data.reason} />
          <Row k="Conduct & Character" v={data.conduct} />
          <Row k="School Dues" v={data.dues} />
          <Row k="Remarks" v={data.remarks} />
        </tbody></table>
        <p className="doc-text">We wish {p.him} every success in {p.his} future life.</p>
      </>
    );
  }
  if (c === 'provisional') {
    const marks = data.marks_obtained && data.total_marks ? <>, securing <b>{data.marks_obtained}</b> marks out of <b>{data.total_marks}</b>{data.grade ? <> (Grade <b>{data.grade}</b>)</> : null}</> : data.grade ? <> with Grade <b>{data.grade}</b></> : null;
    return (
      <>
        <p className="doc-text">This is to certify that <b>{name}</b> {p.rel} <b>{parent}</b>{data.roll_number ? <>, Roll No. <b>{data.roll_number}</b></> : null}{data.admission_number ? <>, Admission No. <b>{data.admission_number}</b></> : null},
          a student of <b>{classText(data.class_label) || 'Class ______'}</b>, has <b>{data.result || 'passed'}</b> the <b>{data.exam || 'Annual Examination'}</b>{data.session ? <> held in <b>{data.session}</b></> : null}{marks}.</p>
        <p className="doc-text">This certificate is issued provisionally on {p.his} request{data.purpose ? <> for the purpose of <b>{data.purpose}</b></> : null}, and is valid until the original certificate / result card is issued.{data.remarks ? ` ${data.remarks}` : ''}</p>
      </>
    );
  }
  return (
    <>
      <p className="doc-text">This is to certify that <b>{name}</b> {p.rel} <b>{parent}</b>{data.admission_number ? <>, Admission No. <b>{data.admission_number}</b></> : null}, has been a bonafide student of {school.name}
        {data.from ? <> from <b>{fmtDate(data.from)}</b></> : null}{data.to ? <> to <b>{fmtDate(data.to)}</b></> : null}{data.class_label ? <>, last studying in <b>{classText(data.class_label)}</b></> : null}.</p>
      <p className="doc-text">To the best of my knowledge, {p.he} bears a <b>{data.conduct || 'good'}</b> moral character. {p.He} {data.activities ? <>took an active part in <b>{data.activities}</b> and </> : null}was found to be disciplined, honest and respectful towards teachers and fellow students. {p.He} has not taken part in any activity against the school or the state.</p>
      <p className="doc-text">I wish {p.him} every success in life.{data.remarks ? ` ${data.remarks}` : ''}</p>
    </>
  );
}

function Doc({ cert, school }) {
  const t = cert.template;
  return (
    <div className={`cert-page cert-port d-${t}`}>
      {t === 'classic' && <div className="dframe" />}
      {t === 'royal' && <><div className="dtop" /><div className="dbot" /></>}
      {t === 'modern' && <div className="dside" />}
      <div style={{ position: 'absolute', inset: t === 'royal' ? '18mm 20mm' : '16mm 20mm' }}>
        <div className="doc-head" style={{ justifyContent: t === 'modern' ? 'flex-start' : 'center', textAlign: t === 'modern' ? 'left' : 'center' }}>
          {school.logo && <img className="cert-logo" src={school.logo} alt="" />}
          <div>
            <div className="cert-school">{school.name}</div>
            {school.contact && <div className="cert-small">{school.contact}</div>}
          </div>
        </div>
        <div style={{ textAlign: t === 'modern' ? 'left' : 'center' }}><span className="doc-title">{DOC_TITLE[cert.category]}</span></div>
        <div className="doc-meta"><span>Serial No: <b>{cert.certificate_number || 'DRAFT'}</b></span><span>Date of Issue: <b>{fmtDate(cert.issue_date)}</b></span></div>
        <div className={t === 'modern' ? '' : 'cert-serif'}><DocBody cert={cert} school={school} /></div>
      </div>
      <div className="doc-sigs">
        <Sig label={cert.data.sig_left || (cert.category === 'leaving' ? 'Prepared by (Clerk)' : 'Class Teacher')} />
        {school.stamp ? <img className="cert-stamp-img" src={school.stamp} alt="School stamp" /> : <div className="doc-stamp">School Stamp</div>}
        <Sig label={cert.data.sig_right || 'Principal'} />
      </div>
    </div>
  );
}

export default function Certificate({ cert, school }) {
  return (
    <div className="cert-root">
      <style>{CSS}</style>
      <div style={{ position: 'relative' }}>
        {isAward(cert.category) ? <Award cert={cert} school={school} /> : <Doc cert={cert} school={school} />}
        {cert.cancelled_at && <div className="cert-void"><span>CANCELLED</span></div>}
      </div>
    </div>
  );
}
