import { REPORTER_ID_STORAGE_KEY, REPORT_UUID_PATTERN } from "@/lib/content-reporting";

export function getOrCreateReporterId() {
  const existing = localStorage.getItem(REPORTER_ID_STORAGE_KEY)?.trim().toLowerCase();
  if (existing && REPORT_UUID_PATTERN.test(existing)) return existing;
  const reporterId = crypto.randomUUID();
  localStorage.setItem(REPORTER_ID_STORAGE_KEY, reporterId);
  return reporterId;
}
