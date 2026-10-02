import { BRAND } from '@/lib/brand';

export function BrandWordmark() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xl font-extrabold tracking-[-0.045em] text-ink sm:text-2xl">
      <span>{BRAND.name}</span>
      <span aria-hidden="true" className="mt-0.5 size-2 rounded-full bg-accent" />
    </span>
  );
}
