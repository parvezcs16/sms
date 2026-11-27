// Small line icons for the dashboard tiles and panels (inherit currentColor).
const PATHS = {
  students: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.2c2.4-.3 4.4 1.2 5 4.3" /></>,
  teacher: <><circle cx="8" cy="7.5" r="3" /><path d="M2.8 19c.5-3 2.5-4.8 5.2-4.8 1.6 0 3 .6 3.9 1.7" /><path d="M13 5h8v7h-8z" /><path d="M15 15l2-3 2 3" /></>,
  staff: <><circle cx="12" cy="7" r="3" /><path d="M6 20c.4-3.6 2.8-6 6-6s5.6 2.4 6 6" /><path d="M10.5 14.5 12 17l1.5-2.5" /></>,
  classes: <><path d="M3 10 12 4l9 6" /><path d="M5 10v9h14v-9" /><path d="M9 19v-5h6v5" /><path d="M8 12h.01M16 12h.01" /></>,
  present: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12.3 2.7 2.7L16.2 9.5" /></>,
  absent: <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7Z" /><path d="M4 7l11-3v3" /><path d="M16 13.5h2" /></>,
  alert: <><path d="M12 3.5 21 19H3L12 3.5Z" /><path d="M12 10v4M12 16.6h.01" /></>,
  chart: <><path d="M4 20V10M10 20V5M16 20v-7M21 20H3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  bolt: <><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></>,
  rocket: <><path d="M14 4c3 0 6 1 6 1s1 3 1 6c0 3-4 7-7 8l-4-4C11 12 11 4 14 4Z" /><circle cx="15.5" cy="8.5" r="1.4" /><path d="M8 13l-3 1-1 4 4-1 1-3" /></>,
  money: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 9.5h.01M17.5 14.5h.01" /></>,
  userPlus: <><circle cx="10" cy="8" r="3.2" /><path d="M4 19c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" /><path d="M19 8v5M16.5 10.5h5" /></>,
  check: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.2 2.5 2.5 4.6-5" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  pen: <><path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" /><path d="M14 7l3 3" /></>,
  printer: <><path d="M7 9V3h10v6" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" /><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  megaphone: <><path d="M4 10v4h3l8 4V6L7 10H4Z" /><path d="M18 9.5c1 .7 1.5 1.5 1.5 2.5s-.5 1.8-1.5 2.5" /></>,
  expense: <><path d="M5 4h14v16H5z" /><path d="M9 8h6M9 12h6M9 16h2" /><path d="M15 15.5l2 2" /></>,
  book: <><path d="M4 5.5C6.5 4.5 9 4.5 12 6c3-1.5 5.5-1.5 8-.5V19c-2.5-1-5-1-8 .5-3-1.5-5.5-1.5-8-.5V5.5Z" /><path d="M12 6v13.5" /></>,
  leave: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m10 13.5 4 4M14 13.5l-4 4" /></>,
  phone: <><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  chat: <><path d="M4 18.5 5.3 15A7.5 7.5 0 1 1 9 18.4L4 18.5Z" /><path d="M9 11h.01M12.5 11h.01M16 11h.01" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-3.8 3.4-6 7-6s6.4 2.2 7 6" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4" /><path d="M12 16.8h.01" /></>
};

export default function DashIcon({ name, size = 22, strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] || PATHS.chart}
    </svg>
  );
}
