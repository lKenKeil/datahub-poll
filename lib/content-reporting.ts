export const REPORT_REASONS = [
  { value: "spam", label: "광고·도배" },
  { value: "harassment", label: "욕설·괴롭힘" },
  { value: "inappropriate", label: "부적절한 콘텐츠" },
  { value: "privacy", label: "개인정보 노출" },
  { value: "other", label: "기타" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
export type ReportTargetType = "poll" | "comment";
export type ModerationAction = "hide" | "restore" | "delete" | "resolve" | "dismiss";
export type ReportQueueStatus = "pending" | "handled" | "all";

export const HIDDEN_COMMENT_PLACEHOLDER = "운영 정책에 따라 숨겨진 의견입니다.";
export const REPORT_DETAIL_MAX_LENGTH = 300;
export const REPORTER_ID_STORAGE_KEY = "dh_reporter_id";

export const REPORT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ContentReportQueueItem = {
  target_type: ReportTargetType;
  target_id: string;
  poll_id: string;
  pending_count: number;
  total_count: number;
  reasons: Array<{ reason: ReportReason; count: number }>;
  latest_report_at: string;
  status: "pending" | "resolved" | "dismissed";
  action: "hide" | "restore" | "delete" | "no_action" | null;
  handled_at: string | null;
  details?: Array<{ detail: string; created_at: string }>;
  preview: {
    text: string | null;
    parent_id: string | null;
    is_hidden: boolean;
    exists: boolean;
    reply_count: number;
    poll_title?: string | null;
  };
};
