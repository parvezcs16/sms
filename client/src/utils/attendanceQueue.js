import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isNetworkError } from '../api/client';

// Offline-safe attendance submissions.
//
// Every save is written to localStorage BEFORE it is sent. If the phone's Wi-Fi
// drops, the server PC is unreachable, or the login has expired (which reloads
// the page to /login), the marks are not lost: they stay queued and are re-sent
// automatically once the server is reachable again / the teacher signs back in.
// The server upserts on (student, date), so re-sending is always safe.
const KEY = 'sms_attendance_queue_v1';
const listeners = new Set();

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full/blocked */ }
  listeners.forEach((fn) => fn(items));
}

export function queueKey(kind, scopeId, date) {
  return `${kind}:${scopeId}:${date}`;
}

// Newer submission for the same class + date replaces the older one.
export function enqueue(item) {
  const items = read().filter((i) => i.key !== item.key);
  items.push({ ...item, queuedAt: new Date().toISOString(), attempts: 0, error: null });
  write(items);
}

export function removeFromQueue(key) {
  write(read().filter((i) => i.key !== key));
}

function endpointFor(item) {
  if (item.kind === 'students') return '/attendance/mark';
  if (item.kind === 'teachers') return '/attendance/teachers/mark';
  if (item.kind === 'staff') return '/staff/attendance/mark';
  throw new Error(`Unknown attendance kind ${item.kind}`);
}

let flushing = null;

// Sends every queued item that belongs to `username`. Returns
// { sent: [{item, result}], failed: [{item, error}], offline: boolean }.
export function flushQueue(username) {
  if (flushing) return flushing;
  flushing = (async () => {
    const outcome = { sent: [], failed: [], offline: false };
    for (const item of read()) {
      if (item.username !== username) continue;
      try {
        const result = await api.post(endpointFor(item), item.payload);
        removeFromQueue(item.key);
        outcome.sent.push({ item, result });
      } catch (err) {
        if (isNetworkError(err)) {
          outcome.offline = true;
          write(read().map((i) => (i.key === item.key ? { ...i, attempts: (i.attempts || 0) + 1, error: 'Waiting for connection to the school server' } : i)));
          break; // no point trying the rest while offline
        }
        if (err.status === 401) break; // being redirected to login; keep everything queued
        // The server rejected it (e.g. class no longer assigned) — keep it visible so it isn't silently lost.
        write(read().map((i) => (i.key === item.key ? { ...i, attempts: (i.attempts || 0) + 1, error: err.message, rejected: true } : i)));
        outcome.failed.push({ item, error: err });
      }
    }
    return outcome;
  })().finally(() => { flushing = null; });
  return flushing;
}

export function useAttendanceQueue(username, onSynced) {
  const [items, setItems] = useState(() => read());
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const lastNotified = useRef(null);

  useEffect(() => {
    const listener = (next) => setItems(next);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  // fromSave = true when called right after the user pressed Save (the caller
  // reports the result itself); background retries notify via onSynced.
  const flush = useCallback(async (fromSave = false) => {
    if (!username) return null;
    const outcome = await flushQueue(username);
    setOnline(!outcome.offline);
    // Several triggers (online event, tab focus, timer) can share one in-flight
    // flush; only announce each outcome once.
    if (!fromSave && outcome.sent.length && onSyncedRef.current && lastNotified.current !== outcome) {
      lastNotified.current = outcome;
      onSyncedRef.current(outcome);
    }
    return outcome;
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    flush();
    const retry = () => flush();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    const timer = setInterval(() => {
      if (read().some((i) => i.username === username && !i.rejected)) flush();
    }, 15000);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      clearInterval(timer);
    };
  }, [username, flush]);

  const mine = items.filter((i) => i.username === username);
  return { pending: mine, online, flush };
}
