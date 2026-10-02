import { appendRecentPollId, RECENT_POLL_LIMIT } from './poll-discovery';

const STORAGE_KEY = 'askio_recent_poll_ids';
let memoryHistory: string[] = [];

// Called after a successful client-side detail load, never during SSR/render.
// No identity, text, analytics properties, or persistent tracking are stored.
export function rememberPollVisit(id: string): string[] {
  if (typeof window === 'undefined') return [];
  let previous = memoryHistory;
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(raw)) {
      previous = raw.filter((value): value is string => typeof value === 'string'
        && /^[a-zA-Z0-9_-]{1,200}$/.test(value)).slice(-RECENT_POLL_LIMIT);
    }
  } catch { /* Storage denial or invalid data falls back to this tab's memory. */ }
  memoryHistory = appendRecentPollId(previous, id);
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryHistory)); } catch { /* Non-critical. */ }
  return [...memoryHistory];
}
