'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // This mount gate intentionally delays theme-dependent UI until hydration completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        aria-label="테마 불러오는 중"
        className="fixed right-4 top-4 z-[100] rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition-all dark:border-white/20 dark:bg-[#020617]/80 dark:text-slate-100"
      >
        THEME
      </button>
    );
  }

  const isDark = resolvedTheme === 'dark';

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
