'use client';

import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = typeof window !== 'undefined';

  if (!mounted) {
    return (
      <button
        type="button"
        className="fixed right-4 top-4 z-[100] rounded-full border border-slate-300/30 bg-white/60 px-3 py-1.5 text-xs font-bold text-slate-500 backdrop-blur dark:border-white/15 dark:bg-[#020617]/70 dark:text-slate-300"
      >
        THEME
      </button>
    );
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="fixed right-4 top-4 z-[100] rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition-all hover:bg-slate-100 dark:border-white/20 dark:bg-[#020617]/80 dark:text-slate-100 dark:hover:bg-[#0b1225]"
    >
      {isDark ? 'LIGHT' : 'DARK'}
    </button>
  );
}
