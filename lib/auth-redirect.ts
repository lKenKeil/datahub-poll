// Do not trust OAuth query parameters or forward arbitrary URLs.
export function getSafeAuthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const decoded = decodeURIComponent(value);
    // Encoded spaces in an ordinary search/hash are safe. Controls and
    // backslashes are not: browsers can interpret them as redirect syntax.
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return '/';
    const url = new URL(value, 'https://askio.invalid');
    // Re-check encoded path syntax without repeatedly decoding normal query
    // values such as a literal percent sign in a search term.
    let path = url.pathname;
    for (let count = 0; count < 4; count += 1) {
      path = decodeURIComponent(path);
      if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith('//')) return '/';
      if (!/%[\da-f]{2}/i.test(path)) break;
    }
    const decodedPath = new URL(path, 'https://askio.invalid').pathname;
    if (url.origin !== 'https://askio.invalid' || /^\/(?:auth|api)(?:\/|$)/.test(decodedPath)) return '/';
    const safePath = `${url.pathname}${url.search}${url.hash}`;
    // URL percent-encoding can expand a short Unicode input past cookie limits.
    return safePath.length <= 2048 ? safePath : '/';
  } catch {
    return '/';
  }
}
