// Do not trust OAuth query parameters or forward arbitrary URLs.
export function getSafeAuthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('//')) return '/';
    const url = new URL(value, 'https://askio.invalid');
    if (url.origin !== 'https://askio.invalid' || /^\/(?:auth|api)(?:\/|$)/.test(decodeURIComponent(url.pathname))) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
