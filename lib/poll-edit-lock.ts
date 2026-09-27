export const POLL_EDIT_LOCK_MODES = [
  "first_vote",
  "time",
  "participants",
  "time_or_participants",
] as const;

export type PollEditLockMode = (typeof POLL_EDIT_LOCK_MODES)[number];

export type PollEditLockConfig = {
  mode: PollEditLockMode;
  minutes: number | null;
  participants: number | null;
};

export type PollStructuralEditLockReason =
  | "first_vote"
  | "time_expired"
  | "participant_limit"
  | "has_comments";

export const DEFAULT_POLL_EDIT_LOCK: PollEditLockConfig = {
  mode: "first_vote",
  minutes: null,
  participants: null,
};

export const MIN_EDIT_LOCK_MINUTES = 1;
export const MAX_EDIT_LOCK_MINUTES = 1440;
export const MIN_EDIT_LOCK_PARTICIPANTS = 1;
export const MAX_EDIT_LOCK_PARTICIPANTS = 1000;

const editLockModes = new Set<string>(POLL_EDIT_LOCK_MODES);

function isIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function parsePollEditLockConfig(value: unknown):
  | { ok: true; value: PollEditLockConfig }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: DEFAULT_POLL_EDIT_LOCK };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "editLock must be an object." };
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["mode", "minutes", "participants"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "editLock contains an unexpected field." };
  }

  if (typeof record.mode !== "string" || !editLockModes.has(record.mode)) {
    return { ok: false, error: "editLock mode is invalid." };
  }

  const mode = record.mode as PollEditLockMode;
  const minutes = record.minutes ?? null;
  const participants = record.participants ?? null;

  if (mode === "first_vote") {
    if (minutes !== null || participants !== null) {
      return { ok: false, error: "first_vote mode cannot have limits." };
    }
    return { ok: true, value: { mode, minutes: null, participants: null } };
  }

  if (mode === "time") {
    if (
      !isIntegerInRange(minutes, MIN_EDIT_LOCK_MINUTES, MAX_EDIT_LOCK_MINUTES)
      || participants !== null
    ) {
      return { ok: false, error: "time mode requires minutes from 1 to 1440." };
    }
    return { ok: true, value: { mode, minutes: Number(minutes), participants: null } };
  }

  if (mode === "participants") {
    if (
      minutes !== null
      || !isIntegerInRange(
        participants,
        MIN_EDIT_LOCK_PARTICIPANTS,
        MAX_EDIT_LOCK_PARTICIPANTS,
      )
    ) {
      return { ok: false, error: "participants mode requires a limit from 1 to 1000." };
    }
    return { ok: true, value: { mode, minutes: null, participants: Number(participants) } };
  }

  if (
    !isIntegerInRange(minutes, MIN_EDIT_LOCK_MINUTES, MAX_EDIT_LOCK_MINUTES)
    || !isIntegerInRange(
      participants,
      MIN_EDIT_LOCK_PARTICIPANTS,
      MAX_EDIT_LOCK_PARTICIPANTS,
    )
  ) {
    return {
      ok: false,
      error: "time_or_participants mode requires minutes from 1 to 1440 and participants from 1 to 1000.",
    };
  }

  return {
    ok: true,
    value: { mode, minutes: Number(minutes), participants: Number(participants) },
  };
}

type PollEditLockStateSource = {
  edit_lock_mode?: unknown;
  edit_lock_minutes?: unknown;
  edit_lock_participants?: unknown;
  created_at?: unknown;
  participants?: unknown;
};

export function getPollStructuralEditState(
  poll: PollEditLockStateSource,
  hasComments: boolean,
  hasVotes = false,
  now = Date.now(),
): {
  structural_edit_allowed: boolean;
  structural_edit_lock_reason: PollStructuralEditLockReason | null;
} {
  if (hasComments) {
    return { structural_edit_allowed: false, structural_edit_lock_reason: "has_comments" };
  }

  const mode = typeof poll.edit_lock_mode === "string" && editLockModes.has(poll.edit_lock_mode)
    ? poll.edit_lock_mode as PollEditLockMode
    : "first_vote";
  const participants = Number.isInteger(poll.participants) && Number(poll.participants) >= 0
    ? Number(poll.participants)
    : 0;

  if (mode === "first_vote") {
    return participants === 0 && !hasVotes
      ? { structural_edit_allowed: true, structural_edit_lock_reason: null }
      : { structural_edit_allowed: false, structural_edit_lock_reason: "first_vote" };
  }

  if (mode === "time" || mode === "time_or_participants") {
    const createdAt = typeof poll.created_at === "string" ? Date.parse(poll.created_at) : Number.NaN;
    const minutes = Number(poll.edit_lock_minutes);
    if (
      !Number.isFinite(createdAt)
      || !isIntegerInRange(minutes, MIN_EDIT_LOCK_MINUTES, MAX_EDIT_LOCK_MINUTES)
      || now >= createdAt + minutes * 60_000
    ) {
      return { structural_edit_allowed: false, structural_edit_lock_reason: "time_expired" };
    }
  }

  if (mode === "participants" || mode === "time_or_participants") {
    const limit = Number(poll.edit_lock_participants);
    if (
      !isIntegerInRange(limit, MIN_EDIT_LOCK_PARTICIPANTS, MAX_EDIT_LOCK_PARTICIPANTS)
      || participants >= limit
    ) {
      return { structural_edit_allowed: false, structural_edit_lock_reason: "participant_limit" };
    }
  }

  return { structural_edit_allowed: true, structural_edit_lock_reason: null };
}
