// Two separate rounded fill shapes stay legible at favicon sizes.
export function BrandMark({ className = 'size-7 md:size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <rect x="10.25" y="0.25" width="15.5" height="37" rx="7.75" transform="rotate(30 18 18.75)" fill="var(--color-primary, #2855d9)" />
      <rect x="28.2" y="19.23" width="15" height="25" rx="7.5" transform="rotate(-20 35.7 31.73)" fill="#d76448" />
    </svg>
  );
}
