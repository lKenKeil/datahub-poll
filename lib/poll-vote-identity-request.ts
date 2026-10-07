'use client';

let pendingRequest: Promise<Response> | null = null;

// Initial viewer/claim responses may establish an HttpOnly guest cookie.
// Serialize them across detail-page lifecycles so a late bootstrap response
// cannot replace the browser identity already used by a newer request.
export function fetchPollVoteIdentity(input: string, init?: RequestInit): Promise<Response> {
  const previous = pendingRequest;
  const request = (async () => {
    if (previous) await previous.catch(() => undefined);
    return fetch(input, init);
  })();
  pendingRequest = request;
  const clearPending = () => {
    if (pendingRequest === request) pendingRequest = null;
  };
  void request.then(clearPending, clearPending);
  return request;
}
