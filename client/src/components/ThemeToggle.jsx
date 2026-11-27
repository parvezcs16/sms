import { useEffect, useState } from 'react';

function getInitialTheme() {
  const saved = localStorage.getItem('sms_theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sms_theme', theme);
  }, [theme]);

  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle dark mode">
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}
