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
  created_at?: string;
};

export type CommentRow = {
  id: string;
  poll_id: string;
  text: string;
  user_name: string;
  created_at: string;
};
