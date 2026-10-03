// Standalone contours traced from the upper-left B1 reference silhouette.
export function BrandMark({ className = 'size-7 md:size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path d="M18.826 7.985 A7.650 7.650 0 0 1 31.600 16.406 L16.037 40.015 A7.650 7.650 0 0 1 3.263 31.594 Z" fill="var(--color-primary, #2855d9)" />
      <path d="M28.339 33.097 A7.386 7.386 0 0 1 41.028 25.534 L44.959 32.129 A7.386 7.386 0 0 1 32.269 39.692 Z" fill="#d76448" />
    </svg>
  );
}
