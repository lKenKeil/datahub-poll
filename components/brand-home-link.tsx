import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { BrandWordmark } from '@/components/brand-wordmark';

export function BrandHomeLink({ showDescriptor = false }: { showDescriptor?: boolean }) {
  return (
    <Link href="/" aria-label={`${BRAND.name} 홈`} className="inline-flex min-h-11 shrink-0 items-center rounded-xl transition-opacity hover:opacity-90">
      <BrandWordmark showDescriptor={showDescriptor} />
    </Link>
  );
}
