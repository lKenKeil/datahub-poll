import { PolicyLinks } from '@/components/policy-links';
import { BRAND } from '@/lib/brand';
import { SERVICE_POLICIES } from '@/lib/service-policies';

export function SiteFooter() {
  return (
    <footer className="mt-auto w-full min-w-0 border-t border-line bg-canvas">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
        <p className="text-xs text-muted">© {SERVICE_POLICIES.reviewedAt.slice(0, 4)} {BRAND.name}</p>
        <PolicyLinks />
      </div>
    </footer>
  );
}
