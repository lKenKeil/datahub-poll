import { BRAND } from '@/lib/brand';
import { BrandMark } from '@/components/brand-mark';

export function BrandWordmark({
  size = 'header',
  showDescriptor = false,
  className = '',
}: { size?: 'header' | 'compact'; showDescriptor?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-2xl font-extrabold leading-none tracking-[-0.04em] text-ink ${size === 'header' ? 'md:text-4xl' : ''} ${className}`}>
      <BrandMark className={size === 'header' ? 'size-7 md:size-10' : 'size-7'} />
      <span>{BRAND.name}<span style={{ color: '#d76448' }}>.</span></span>
      {showDescriptor ? <span className="ml-2 hidden text-sm font-medium leading-normal tracking-normal text-muted xl:inline">{BRAND.descriptor}</span> : null}
    </span>
  );
}
