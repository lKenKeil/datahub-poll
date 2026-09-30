import { BRAND } from '@/lib/brand';

export function BrandWordmark() {
  return (
    <span className="inline-flex items-center gap-1 text-xl font-black tracking-[-0.04em] text-slate-950 dark:text-white sm:text-2xl">
      <span>{BRAND.name}</span>
      <span aria-hidden="true" className="mt-0.5 size-2 rounded-full bg-blue-600 dark:bg-blue-400" />
    </span>
  );
}
