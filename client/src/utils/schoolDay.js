import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

// Watches the school server's date. When it changes (midnight, or the PC is
// woken up the next morning) a "school-day-changed" event is sent so daily
// screens — attendance, self check-in, dashboard — move on to the new day.
let current = null;

export function startDayWatcher() {
  const check = () => api.get('/attendance/server-date').then((r) => {
    if (current && r.date !== current) window.dispatchEvent(new CustomEvent('school-day-changed', { detail: { date: r.date, previous: current } }));
    current = r.date;
  }).catch(() => {});
  check();
  const id = setInterval(check, 60000);
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(id);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function onSchoolDayChange(fn) {
  const h = (e) => fn(e.detail.date, e.detail.previous);
  window.addEventListener('school-day-changed', h);
  return () => window.removeEventListener('school-day-changed', h);
}

// A number that goes up each time the school day changes (use as a reload key).
export function useSchoolDayTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => onSchoolDayChange(() => setTick((t) => t + 1)), []);
  return tick;
}

// Keeps a date picker on "today": if it was showing the old today, it moves
// to the new one. A date the user picked on purpose (an earlier day) stays.
export function useFollowToday(today, date, setDate) {
  const prev = useRef(today);
  useEffect(() => {
    if (today && prev.current && prev.current !== today && date === prev.current) setDate(today);
    if (today && !date) setDate(today);
    prev.current = today;
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps
}
