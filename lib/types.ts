export type PollOptionVotes = number[];

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
  official_fact?: string;
  created_at?: string;
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
  like_count?: number;
  dislike_count?: number;
  user_reaction?: "like" | "dislike" | null;
};
