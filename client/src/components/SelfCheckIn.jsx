import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { onSchoolDayChange } from '../utils/schoolDay';

const STATUS_TEXT = {
  self: 'You checked in yourself',
  auto: 'Marked automatically when you took class attendance',
  manual: 'Marked by the office'
};

// Shown to a teacher until they are marked for the day. One tap marks them
// Present on the school server (the server's date is used, not the device's).
// compact: the slim banner shown on top of every page.
export default function SelfCheckIn({ compact = false }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user.teacher_id && !user.staff_id) return;
    api.get('/attendance/me/today').then(setState).catch(() => {});
  }, [user.teacher_id, user.staff_id]);

  useEffect(() => {
    load();
    // Re-check when the app comes back into focus (e.g. the next morning).
    window.addEventListener('focus', load);
    const offDay = onSchoolDayChange(() => { setState(null); load(); });
    return () => { window.removeEventListener('focus', load); offDay(); };
  }, [load]);

  if ((!user.teacher_id && !user.staff_id) || !state || !state.applicable) return null;
  const rec = state.record;

  async function checkIn() {
    setBusy(true);
    try {
      const res = await api.post('/attendance/me/check-in', {});
      setState({ applicable: true, date: res.date, record: res.record });
      if (res.created) toast.success(`You're marked Present for ${res.date} — saved on the school server`);
      else toast.info(`Already marked ${res.record.status} for ${res.date}`);
    } catch (err) {
      toast.error(`Not saved: ${err.message}. Check the connection and try again.`);
    } finally {
      setBusy(false);
    }
  }

  if (rec) {
    if (compact) return null; // nothing to nag about once marked
    return (
      <div className="card checkin-card checkin-done">
        <div>
          <span className="stat-label">My attendance · {state.date}</span>
          <div className="checkin-status">✔ {rec.status}</div>
          <span className="stat-sub">{STATUS_TEXT[rec.source] || 'Marked'}{rec.marked_at ? ` · ${rec.marked_at.slice(11, 16)}` : ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'checkin-banner' : 'card checkin-card'}>
      <div>
        {compact ? (
          <span>👋 Good day, {user.full_name.split(' ')[0]} — you haven't checked in for <b>{state.date}</b>.</span>
        ) : (
          <>
            <span className="stat-label">My attendance · {state.date}</span>
            <div className="checkin-status muted">Not marked yet</div>
            <span className="stat-sub">Tap the button when you arrive — it's saved straight to the school server.</span>
          </>
        )}
      </div>
      <button type="button" className="btn-success" onClick={checkIn} disabled={busy}>
        {busy ? 'Saving…' : "✔ I'm Present"}
      </button>
    </div>
  );
}
