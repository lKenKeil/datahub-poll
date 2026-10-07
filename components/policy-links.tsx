import Link from 'next/link';
import { SERVICE_POLICIES } from '@/lib/service-policies';

export function PolicyLinks({ newTab = false }: { newTab?: boolean }) {
  const externalProps = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <nav aria-label="서비스 정책" className="flex flex-wrap items-center gap-x-4 text-xs text-muted">
      <Link href={SERVICE_POLICIES.privacy.href} {...externalProps} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
        개인정보처리방침{newTab && <span className="sr-only"> (새 탭)</span>}
      </Link>
      <Link href={SERVICE_POLICIES.terms.href} {...externalProps} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
        이용약관{newTab && <span className="sr-only"> (새 탭)</span>}
      </Link>
    </nav>
  );
}
