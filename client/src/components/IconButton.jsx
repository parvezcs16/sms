// Compact icon buttons for table row actions. Each shows a tooltip and has an
// accessible label, so a row of 6-7 actions fits on one line instead of
// wrapping into a wall of text buttons.
const PATHS = {
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  key: 'M15.5 7.5a3.5 3.5 0 1 1-3.4 4.3L4 20v-3h2v-2h2l2.2-2.2A3.5 3.5 0 0 1 15.5 7.5Zm1 2.5h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  relieve: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  rejoin: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M14 7l-5 5 5 5M9 12h12',
  pay: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v.01M18 14v.01',
  pdf: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M9 13h6M9 17h4',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4Z',
  check: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM4.9 4.9l14.2 14.2',
  receipt: 'M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2ZM8 8h8M8 12h8M8 16h5',
  plus: 'M12 5v14M5 12h14'
};

export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.edit} />
    </svg>
  );
}

// tone: 'default' | 'danger' | 'success' | 'primary'
export default function IconButton({ icon, label, onClick, tone = 'default', disabled = false, busy = false }) {
  return (
    <button
      type="button"
      className={`icon-action tone-${tone}`}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      data-tip={label}
    >
      {busy ? <span className="icon-spinner" /> : <Icon name={icon} />}
    </button>
  );
}

// A link-style icon (e.g. View profile) that keeps the same look.
export function IconLink({ icon, label, to, LinkComponent }) {
  return (
    <LinkComponent to={to} className="icon-action tone-default" title={label} aria-label={label} data-tip={label} onClick={(e) => e.stopPropagation()}>
      <Icon name={icon} />
    </LinkComponent>
  );
}
