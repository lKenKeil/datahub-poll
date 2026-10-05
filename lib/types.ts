export type PollOptionVotes = number[];

export type PollEditLockMode =
  | "first_vote"
  | "time"
  | "participants"
  | "time_or_participants";

export type PollStructuralEditLockReason =
  | "first_vote"
  | "time_expired"
  | "participant_limit"
  | "has_comments";

export type PollCategory =
  | "학술/통계"
  | "IT/테크"
  | "사회/경제"
  | "라이프스타일"
  | "커뮤니티";

export type OfficialPoll = {
  id: string;
  title: string;
  category: Exclude<PollCategory, "커뮤니티">;
  options: string[];
  participants: number;
  stats: number[];
  officialFact: string;
};

export type DbPoll = {
  id: string;
  title: string;
  category: PollCategory;
  options: string[];
  votes: PollOptionVotes;
  participants: number;
  is_hidden?: boolean;
  official_fact?: string;
  option_image_paths?: Array<string | null> | null;
  created_at?: string;
  edit_lock_mode?: PollEditLockMode;
  edit_lock_minutes?: number | null;
  edit_lock_participants?: number | null;
  structural_edit_allowed?: boolean;
  structural_edit_lock_reason?: PollStructuralEditLockReason | null;
  is_anonymous?: boolean;
};

export type OfficialStatistic = {
  id: string;
  source_id: string;
  category: string;
  title: string;
  summary?: string | null;
  source_url: string;
  methodology?: string | null;
  sample_size?: number | null;
  observed_at?: string | null;
  published_at?: string | null;
  confidence_note?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  is_verified?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CommentRow = {
  id: string;
  poll_id: string;
  text: string;
  user_name: string;
  created_at: string;
  parent_id?: string | null;
  is_hidden?: boolean;
  like_count?: number;
  dislike_count?: number;
  user_reaction?: "like" | "dislike" | null;
  is_anonymous?: boolean;
  displayName?: string;
  nickname?: string;
  avatar_url?: string | null;
};
