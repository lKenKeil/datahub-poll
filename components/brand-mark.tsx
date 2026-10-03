// Two separate rounded fill shapes stay legible at favicon sizes.
export function BrandMark({ className = 'size-7 md:size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <rect x="13" y="-0.5" width="12" height="47" rx="6" transform="rotate(31 19 23)" fill="var(--color-primary, #2855d9)" />
      <rect x="31.75" y="19.25" width="10" height="26" rx="5" transform="rotate(-32.2 36.75 32.25)" fill="#d76448" />
    </svg>
  );
}
