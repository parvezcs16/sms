import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import { fmtDateTime } from '../utils/payment';

// Share the class diary / one homework / the syllabus on WhatsApp:
//  - to every parent of the class (each gets it on their own WhatsApp), and/or
//  - into the class WhatsApp group,
// from the school's linked WhatsApp number. "Open in WhatsApp" works without
// linking: WhatsApp opens with the text ready and you pick the chat or group.
// request: { kind: 'diary' | 'homework' | 'syllabus', section_id, date, homework_id, class_id, subject_id, term }
export default function WhatsAppShareModal({ request, onClose }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [toParents, setToParents] = useState(true);
  const [toGroup, setToGroup] = useState(true);
  const [picked, setPicked] = useState({});
  const [groups, setGroups] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  async function loadPreview() {
    try {
      const r = await api.post('/homework/share/preview', request);
      setInfo(r);
      setText(r.text);
      setPicked(Object.fromEntries(r.sections.map((s) => [s.id, true])));
      if (!r.sections.some((s) => s.group)) setToGroup(false);
      if (r.whatsapp === 'connected') api.get('/homework/share/groups').then(setGroups).catch(() => setGroups({ groups: [] }));
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { loadPreview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setGroup(section, groupId) {
    const g = (groups?.groups || []).find((x) => x.id === groupId);
    try {
      await api.put(`/homework/share/groups/${section.id}`, g ? { id: g.id, name: g.name } : {});
      setInfo({ ...info, sections: info.sections.map((s) => (s.id === section.id ? { ...s, group: g ? { id: g.id, name: g.name } : null } : s)) });
      if (g) setToGroup(true);
    } catch (err) { toast.error(err.message); }
  }

  async function send() {
    const ids = info.sections.filter((s) => picked[s.id]).map((s) => s.id);
    if (!ids.length) { toast.error('Choose at least one class'); return; }
    if (info.last && !window.confirm(`This was already sent on ${fmtDateTime(info.last.created_at)} by ${info.last.created_by_name || 'someone'}. Send it again?`)) return;
    setSending(true);
    try {
      const r = await api.post('/homework/share/send', { ...request, text, to_parents: toParents, to_group: toGroup, section_ids: ids });
      setResult(r);
      const parts = [];
      if (toParents) parts.push(`${r.sent} of ${r.parents} parents`);
      if (toGroup && r.groups) parts.push(`${r.groups_sent} of ${r.groups} class group${r.groups === 1 ? '' : 's'}`);
      toast.success(`Sent on WhatsApp to ${parts.join(' and ') || 'nobody'}${r.failed ? ` · ${r.failed} failed` : ''}`);
    } catch (err) { toast.error(err.message); }
    setSending(false);
  }

  function openWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied — paste it into any WhatsApp chat or group'); } catch { toast.error('Could not copy'); }
  }

  const linked = info?.whatsapp === 'connected';
  const totalParents = info ? info.sections.filter((s) => picked[s.id]).reduce((n, s) => n + s.parents, 0) : 0;

  return (
    <Modal title={info ? `Share on WhatsApp — ${info.title}` : 'Share on WhatsApp'} onClose={onClose} wide
      footer={info && (
        <>
          <button type="button" className="btn-ghost" onClick={copy}>Copy text</button>
          <button type="button" className="btn-secondary" onClick={openWhatsApp} title="Opens WhatsApp with this message — choose a chat or group yourself">Open in WhatsApp</button>
          <button type="button" className="btn-success" disabled={!linked || sending || (!toParents && !toGroup)} onClick={send}>{sending ? 'Sending…' : '📤 Send now'}</button>
        </>
      )}>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!info && !error && <p className="muted">Preparing…</p>}
      {info && (
        <>
          {info.last && (
            <p style={{ background: 'rgba(234,179,8,0.12)', padding: '6px 10px', borderRadius: 8, fontSize: '0.85rem', marginTop: 0 }}>
              Already shared on {fmtDateTime(info.last.created_at)} by {info.last.created_by_name || '—'}
              {info.last.to_parents ? ` · ${info.last.to_parents} parents` : ''}{info.last.to_group ? ` · group: ${info.last.to_group}` : ''}.
            </p>
          )}
          <div className="field">
            <label>Message (you can edit it before sending)</label>
            <textarea rows={Math.min(16, Math.max(6, text.split('\n').length + 1))} value={text} onChange={(e) => setText(e.target.value)} dir="auto" style={{ fontFamily: 'inherit' }} />
          </div>

          {!linked && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              The school WhatsApp number is not linked, so the app can’t send by itself. Use <b>Open in WhatsApp</b> to send it from this PC’s WhatsApp (choose the class group or a parent),
              or link the school number once in <b>Settings → WhatsApp</b> to send to all parents and class groups with one click.
            </p>
          )}

          {linked && (
            <>
              <div className="row" style={{ gap: 18, margin: '4px 0 8px' }}>
                <label className="row" style={{ margin: 0, gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={toParents} onChange={(e) => setToParents(e.target.checked)} /> Each parent’s WhatsApp ({totalParents})</label>
                <label className="row" style={{ margin: 0, gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={toGroup} onChange={(e) => setToGroup(e.target.checked)} /> Class WhatsApp group</label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th style={{ width: 30 }} /><th>Class</th><th>Parents with a phone</th><th>Class WhatsApp group</th></tr></thead>
                  <tbody>
                    {info.sections.map((s) => (
                      <tr key={s.id}>
                        <td><input type="checkbox" style={{ width: 'auto' }} checked={Boolean(picked[s.id])} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} /></td>
                        <td>{s.label}</td>
                        <td>{s.parents}</td>
                        <td>
                          {groups && groups.groups.length > 0 ? (
                            <select value={s.group?.id || ''} onChange={(e) => setGroup(s, e.target.value)}>
                              <option value="">— no group —</option>
                              {s.group && !groups.groups.some((g) => g.id === s.group.id) && <option value={s.group.id}>{s.group.name}</option>}
                              {groups.groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.members ? ` (${g.members})` : ''}</option>)}
                            </select>
                          ) : (
                            <span className="muted" style={{ fontSize: '0.8rem' }}>{s.group ? s.group.name : groups ? 'The school number is not in any WhatsApp group yet' : 'Loading groups…'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                To post in a class group, add the school’s WhatsApp number to that group (as admin if only admins can post), then pick it above — it’s remembered for next time.
              </p>
            </>
          )}

          {result && result.no_group.length > 0 && toGroup && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>No WhatsApp group chosen for: {result.no_group.join(', ')}</p>
          )}
        </>
      )}
    </Modal>
  );
}
