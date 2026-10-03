import { BRAND } from '@/lib/brand';

export function BrandWordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-2xl font-extrabold leading-none tracking-[-0.04em] text-ink md:text-[32px]">
      <span>{BRAND.name}</span>
      <span aria-hidden="true" className="mt-1 size-2.5 rounded-full bg-accent md:size-3" />
    </span>
  );
}
