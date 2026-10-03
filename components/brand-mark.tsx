// Two separate rounded fill shapes stay legible at favicon sizes.
export function BrandMark({ className = 'size-7 md:size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path fill="var(--color-primary, #2855d9)" d="M5.77 10.67A5 5 0 0 1 14.23 5.33L31.23 32.33A5 5 0 0 1 22.77 37.67Z" />
      <path fill="#d76448" d="M45.76 30.37L41.76 41.37A4 4 0 0 1 34.24 38.63L38.24 27.63A4 4 0 0 1 45.76 30.37Z" />
    </svg>
  );
}
