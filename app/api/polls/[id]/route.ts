import { NextResponse } from "next/server";
import { POLLS } from "@/data/polls";
import { isModerationMigrationMissing, moderationErrorResponse } from "@/lib/content-report-server";
import { getSupabaseMutationClient, supabaseServer } from "@/lib/supabase-server";
import { isValidVoterId } from "@/lib/voter-id";
import {
  accountVotingMigrationResponse,
  getPollViewerVote,
  getPollVoteIdentityStatus,
  isAccountVotingMigrationMissing,
  withPrivateVoteHeaders,
} from "@/lib/poll-vote-server";
import { getPollVoteActor, withVoteActorCookie } from '@/lib/poll-vote-identity';
import { parseCommentSort, sortComments } from '@/lib/comment-sorting';
import type { PollCategory } from "@/lib/types";
import { authorizePollOwner } from "@/lib/poll-owner-auth";
import {
  parsePollOwnerPatchRequest,
  PollOwnerPatchRequestError,
} from "@/lib/poll-owner-update";
import {
  PollOptionImageStorageError,
  PollOptionImageValidationError,
  type ValidatedOptionImage,
} from "@/lib/poll-option-image-errors";
import {
  removePollOptionImages,
  uploadPollOptionImages,
} from "@/lib/poll-option-image-storage";
import { getValidatedPollOptionImagePath } from "@/lib/poll-option-image-paths";
import { deletePollWithImageCleanup } from "@/lib/poll-deletion";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  getUnsafeTextInputMessage,
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";
import { getUnicodeCodePointLength } from "@/lib/unicode-length";
import {
  getPollStructuralEditState,
  type PollEditLockMode,
} from "@/lib/poll-edit-lock";
import {
  PUBLIC_POLL_COLUMNS,
  PUBLIC_COMMENT_COLUMNS,
  serializePublicPoll,
  serializePublicComment,
  type PublicProfileIdentity,
} from "@/lib/public-identity";

type Context = { params: Promise<{ id: string }> };

const validCategories = new Set<PollCategory>([
  "학술/통계",
  "IT/테크",
  "사회/경제",
  "라이프스타일",
  "커뮤니티",
]);

const OWNER_FORBIDDEN_MESSAGE = "투표 관리 권한을 확인할 수 없습니다.";
const OWNER_MUTATION_MIGRATION_MESSAGE =
  "투표 수정·삭제 설정이 아직 적용되지 않았습니다. 관리자에게 문의해주세요.";
const STRUCTURAL_LOCK_REASONS = new Set([
  "first_vote", "time_expired", "participant_limit", "has_comments",
]);

type MutablePollRow = {
  id: string;
  title: string;
  category: PollCategory;
  options: string[];
  votes: number[];
  participants: number | null;
  is_hidden: boolean;
  official_fact: string | null;
  option_image_paths: unknown;
  created_at?: string;
  edit_lock_mode?: PollEditLockMode;
  edit_lock_minutes?: number | null;
  edit_lock_participants?: number | null;
};

function isOwnerMutationMigrationMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  return record.code === "PGRST202"
    || (((record.code === "42883" || record.code === "42P01")
      && Boolean(record.message?.includes("owned_poll") || record.message?.includes("delete_poll_with_dependents")))
      || (record.code === "42703" && Boolean(record.message?.includes("edit_lock_"))));
}

function validatePollId(id: string) {
  return Boolean(id.trim())
    && getUnicodeCodePointLength(id) <= 200
    && !hasUnsafeInputControlCharacters(id);
}

function getCurrentValidImagePaths(poll: MutablePollRow) {
  if (!Array.isArray(poll.option_image_paths)) {
    return Array<string | null>(poll.options.length).fill(null);
  }

  return poll.options.map((_, index) => getValidatedPollOptionImagePath(
    poll.id,
    index,
    typeof (poll.option_image_paths as unknown[])[index] === "string"
      ? (poll.option_image_paths as string[])[index]
      : null,
  ));
}

function getDefaultRetainedImagePaths(
  currentOptions: string[],
  currentPaths: Array<string | null>,
  nextOptions: string[],
) {
  const normalizedCurrentOptions = currentOptions.map((option) => option.trim().toLocaleLowerCase());
  const normalizedNextOptions = nextOptions.map((option) => option.toLocaleLowerCase());

  return nextOptions.map((option, index) => {
    if (index >= currentOptions.length) return null;
    const nextOption = option.toLocaleLowerCase();
    const currentOption = normalizedCurrentOptions[index];
    if (currentOption === nextOption) return currentPaths[index] ?? null;

    // Moving/deleting an option changes its positional image index. Do not
    // silently attach the old image to a different option; the client may
    // upload a replacement for the new index in the same request.
    if (
      normalizedCurrentOptions.includes(nextOption)
      || normalizedNextOptions.includes(currentOption)
    ) return null;

    // A label-only edit at the same position keeps that option's image.
    return currentPaths[index] ?? null;
  });
}

function validateRetainedImagePaths(
  pollId: string,
  value: unknown,
  nextOptionCount: number,
  allowedPaths: Set<string>,
) {
  if (!Array.isArray(value) || value.length !== nextOptionCount) return null;

  const seen = new Set<string>();
  const result: Array<string | null> = [];
  for (const item of value) {
    if (item === null) {
      result.push(null);
      continue;
    }
    if (
      typeof item !== "string"
      || !allowedPaths.has(item)
      || seen.has(item)
      || getValidatedPollOptionImagePath(pollId, result.length, item) !== item
    ) return null;
    seen.add(item);
    result.push(item);
  }
  return result;
}

export async function GET(request: Request, context: Context) {
  const headers = { "Cache-Control": "private, no-store" };
  const unavailable = () => NextResponse.json(
    { error: "질문을 찾을 수 없습니다.", unavailable: true },
    { status: 404, headers },
  );

  try {
    const { id } = await context.params;
    if (!validatePollId(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400, headers });
    }
    const identity = await getPollVoteActor(request, false);
    if (!identity.actor) return identity.response;
    const actor = identity.actor;
    const reactionActor = actor.reactionKey;
    const finish = (response: NextResponse) => withVoteActorCookie(response, actor, request);
    const voterId = actor.viewerVerified ? request.headers.get("x-voter-id")?.trim().toLowerCase() ?? "" : "";
    if (voterId && !isValidVoterId(voterId)) {
      return NextResponse.json({ error: "invalid voter id." }, { status: 400, headers });
    }

    const supabaseMutation = getSupabaseMutationClient();
    if (id.startsWith("official_")) {
      const { data: deletedOfficial, error: deletedOfficialError } = await supabaseMutation
        .from("deleted_official_polls").select("poll_id").eq("poll_id", id).maybeSingle();
      if (deletedOfficialError) throw deletedOfficialError;
      if (deletedOfficial) return unavailable();
    }
    const { data: availability, error: availabilityError } = await supabaseMutation
      .from("polls")
      .select("id,is_hidden")
      .eq("id", id)
      .maybeSingle();
    if (availabilityError) throw availabilityError;
    if (availability?.is_hidden) return unavailable();
    if (!availability) {
      const isStaticOfficial = id.startsWith("official_")
        && POLLS.some((poll) => `official_${poll.id}` === id);
      if (!isStaticOfficial) return unavailable();
      // A genuinely DB-less static question remains readable, but cannot be
      // reported or mutated as though it were a persisted poll.
      return finish(NextResponse.json(
        { poll: null, comments: [], viewerVote: null, viewerIdentityStatus: getPollVoteIdentityStatus(actor), reportable: false },
        { headers },
      ));
    }

    const [
      { data: poll, error: pollError },
      { data: comments, error: commentsError },
      { data: commentAuthors, error: commentAuthorsError },
    ] = await Promise.all([
      supabaseServer.from("polls").select(PUBLIC_POLL_COLUMNS).eq("id", id).eq("is_hidden", false).maybeSingle(),
      supabaseServer.from("comments").select(PUBLIC_COMMENT_COLUMNS).eq("poll_id", id)
        .eq("is_hidden", false).order("created_at", { ascending: false }),
      supabaseMutation.from("comments").select("id,user_id,is_anonymous")
        .eq("poll_id", id).eq("is_hidden", false),
    ]);
    if (pollError) throw pollError;
    if (commentsError) throw commentsError;
    if (commentAuthorsError) throw commentAuthorsError;
    if (!poll) return unavailable();

    const viewerVote = await getPollViewerVote(supabaseMutation, id, actor, voterId);
    let hasAnyVotes = Number(poll.participants) > 0;
    if (!hasAnyVotes && (!poll.edit_lock_mode || poll.edit_lock_mode === "first_vote")) {
      const { data: existingVote, error: existingVoteError } = await supabaseMutation
        .from("poll_votes").select("id").eq("poll_id", id).limit(1).maybeSingle();
      if (existingVoteError) throw existingVoteError;
      hasAnyVotes = Boolean(existingVote);
    }

    const visibleComments = (comments ?? []) as Array<Record<string, unknown>>;
    const visibleIds = visibleComments.map((comment) => String(comment.id));
    const byComment = new Map<string, { like: number; dislike: number; userReaction: "like" | "dislike" | null }>();
    if (visibleIds.length > 0) {
      const { data: reactions, error: reactionsError } = await supabaseMutation
        .from("comment_reactions").select("comment_id,reaction,user_fingerprint")
        .in("comment_id", visibleIds);
      if (reactionsError) throw reactionsError;
      for (const row of reactions ?? []) {
        const key = String(row.comment_id);
        const bucket = byComment.get(key) ?? { like: 0, dislike: 0, userReaction: null };
        if (row.reaction === "like") bucket.like += 1;
        if (row.reaction === "dislike") bucket.dislike += 1;
        if (reactionActor && row.user_fingerprint === reactionActor
          && (row.reaction === "like" || row.reaction === "dislike")) {
          bucket.userReaction = row.reaction;
        }
        byComment.set(key, bucket);
      }
    }

    const visibleById = new Map(visibleComments.map((comment) => [String(comment.id), comment]));
    const publicAuthorIds = [...new Set((commentAuthors ?? [])
      .filter((author) => author.is_anonymous !== true && typeof author.user_id === "string"
        && visibleById.has(String(author.id)))
      .map((author) => String(author.user_id)))];
    const authorProfiles = new Map<string, PublicProfileIdentity>();
    if (publicAuthorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseMutation
        .from("profiles").select("id,nickname,avatar_url,show_avatar").in("id", publicAuthorIds);
      if (profilesError) throw profilesError;
      for (const profile of profiles ?? []) {
        if (typeof profile.nickname === "string") authorProfiles.set(String(profile.id), profile);
      }
    }

    // Recheck availability after public reads and profile lookup. No async
    // work follows this boundary, keeping moderation races fail-closed.
    // Privileged comment reads
    // contain only identifiers, internal authorship and visibility, never
    // hidden original content. No account identifier leaves this handler.
    const [{ data: currentPoll, error: currentPollError }, { data: commentStates, error: commentStatesError }] = await Promise.all([
      supabaseMutation.from("polls").select("id,is_hidden").eq("id", id).maybeSingle(),
      supabaseMutation.from("comments").select("id,poll_id,parent_id,is_hidden,user_id,is_anonymous")
        .eq("poll_id", id).order("created_at", { ascending: false }),
    ]);
    if (currentPollError) throw currentPollError;
    if (commentStatesError) throw commentStatesError;
    if (!currentPoll || currentPoll.is_hidden) return unavailable();

    const enriched = (commentStates ?? []).flatMap<Record<string, unknown>>((state) => {
      if (state.is_hidden) {
        return [{
          id: String(state.id), poll_id: id, parent_id: state.parent_id ?? null,
          text: "운영 정책에 따라 숨겨진 의견입니다.", is_hidden: true,
          user_name: "", created_at: "", like_count: 0, dislike_count: 0, user_reaction: null,
        }];
      }
      const original = visibleById.get(String(state.id));
      if (!original) return [];
      const counts = byComment.get(String(state.id));
      return [{
        ...serializePublicComment(
          { ...original, parent_id: state.parent_id ?? null, is_anonymous: state.is_anonymous === true, is_hidden: false },
          state.is_anonymous === true ? null : authorProfiles.get(String(state.user_id)) ?? null,
          typeof state.user_id === "string",
        ),
        like_count: counts?.like ?? 0, dislike_count: counts?.dislike ?? 0,
        user_reaction: counts?.userReaction ?? null,
      }];
    });
    return finish(NextResponse.json({
      poll: {
        ...serializePublicPoll(poll),
        ...getPollStructuralEditState(poll, (commentStates ?? []).length > 0, hasAnyVotes),
      },
      comments: sortComments(enriched as Array<Record<string, unknown> & { id: unknown }>, parseCommentSort(new URL(request.url).searchParams.get('comments'))), viewerVote,
      viewerIdentityStatus: getPollVoteIdentityStatus(actor), reportable: true,
    }, { headers }));
  } catch (error) {
    if (isAccountVotingMigrationMissing(error)) return accountVotingMigrationResponse();
    if (isModerationMigrationMissing(error)) return withPrivateVoteHeaders(moderationErrorResponse(error, "poll-detail-read"));
    logPublicMutationError("poll-detail-read", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers });
  }
}

export async function PATCH(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.pollOwnerUpdate);
  if (rateLimitResponse) return rateLimitResponse;

  let uploadedPaths: string[] = [];
  let supabaseMutation: ReturnType<typeof getSupabaseMutationClient> | null = null;

  try {
    supabaseMutation = getSupabaseMutationClient();
    const { id } = await context.params;
    if (!validatePollId(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400 });
    }

    const authorization = await authorizePollOwner(request, id, supabaseMutation);
    if (!authorization.ok) {
      if (authorization.reason === "internal") {
        logPublicMutationError("poll-owner-auth", authorization.error);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
      }
      return NextResponse.json(
        { error: authorization.reason === "not_found" ? "poll not found." : OWNER_FORBIDDEN_MESSAGE },
        { status: authorization.status },
      );
    }

    const { data: currentData, error: currentError } = await supabaseMutation
      .from("polls")
      .select("id,title,category,options,votes,participants,is_hidden,official_fact,option_image_paths,created_at,edit_lock_mode,edit_lock_minutes,edit_lock_participants")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      if (isModerationMigrationMissing(currentError)) return moderationErrorResponse(currentError, "poll-owner-update-read");
      if (isOwnerMutationMigrationMissing(currentError)) {
        return NextResponse.json(
          { code: "POLL_OWNER_MUTATION_MIGRATION_REQUIRED", error: OWNER_MUTATION_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }
      logPublicMutationError("poll-owner-update-read", currentError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }
    if (!currentData || currentData.is_hidden) {
      return NextResponse.json({ error: "poll not found." }, { status: 404 });
    }

    const current = currentData as MutablePollRow;
    const raw = await parsePollOwnerPatchRequest(request);
    const hasPatchField = raw.title !== undefined
      || raw.category !== undefined
      || raw.options !== undefined
      || raw.officialFact !== undefined
      || raw.retainedOptionImagePaths !== undefined
      || raw.optionImages.size > 0;
    if (!hasPatchField) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    if (raw.title !== undefined && typeof raw.title !== "string") {
      return NextResponse.json({ error: "title must be a string." }, { status: 400 });
    }
    if (raw.category !== undefined && typeof raw.category !== "string") {
      return NextResponse.json({ error: "category must be a string." }, { status: 400 });
    }
    if (
      raw.options !== undefined
      && (!Array.isArray(raw.options) || !raw.options.every((value) => typeof value === "string"))
    ) {
      return NextResponse.json({ error: "options must be a string array." }, { status: 400 });
    }
    if (raw.officialFact !== undefined && typeof raw.officialFact !== "string") {
      return NextResponse.json({ error: "official_fact must be a string." }, { status: 400 });
    }

    const titleInput = typeof raw.title === "string" ? raw.title : current.title;
    const optionInputs = Array.isArray(raw.options) ? raw.options as string[] : current.options;
    const officialFactInput = typeof raw.officialFact === "string"
      ? raw.officialFact
      : current.official_fact ?? "";
    const unsafeInputMessage = getUnsafeTextInputMessage([
      { label: "투표 질문", value: titleInput },
      ...optionInputs.map((value, index) => ({ label: `선택지 ${index + 1}`, value })),
      { label: "설명 또는 참고정보", value: officialFactInput },
    ]);
    if (unsafeInputMessage) {
      return NextResponse.json({ error: unsafeInputMessage }, { status: 400 });
    }

    const title = titleInput.trim();
    const category = (typeof raw.category === "string" ? raw.category.trim() : current.category) as PollCategory;
    const options = optionInputs.map((value) => value.trim());
    const officialFact = officialFactInput.trim();

    const titleLength = getUnicodeCodePointLength(title);
    if (titleLength < 3 || titleLength > 120) {
      return NextResponse.json({ error: "title must be 3-120 chars." }, { status: 400 });
    }
    if (!validCategories.has(category)) {
      return NextResponse.json({ error: "invalid category." }, { status: 400 });
    }
    if (
      options.length < 2
      || options.length > 6
      || options.some((option) => !option || getUnicodeCodePointLength(option) > 50)
    ) {
      return NextResponse.json(
        { error: "options must be 2-6 values of 1-50 chars." },
        { status: 400 },
      );
    }
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      return NextResponse.json({ error: "options must be unique." }, { status: 400 });
    }
    if (getUnicodeCodePointLength(officialFact) > 300) {
      return NextResponse.json(
        { error: "official_fact must be at most 300 chars." },
        { status: 400 },
      );
    }

    for (const optionIndex of raw.optionImages.keys()) {
      if (optionIndex < 0 || optionIndex >= options.length) {
        return NextResponse.json(
          { error: `optionImages[${optionIndex}] does not match an option.` },
          { status: 400 },
        );
      }
    }

    const currentPaths = getCurrentValidImagePaths(current);
    const allowedCurrentPaths = new Set(
      currentPaths.filter((path): path is string => Boolean(path)),
    );
    let nextImagePaths: Array<string | null>;

    if (raw.retainedOptionImagePaths !== undefined) {
      const validatedRetainedPaths = validateRetainedImagePaths(
        id,
        raw.retainedOptionImagePaths,
        options.length,
        allowedCurrentPaths,
      );
      if (!validatedRetainedPaths) {
        return NextResponse.json(
          { error: "retainedOptionImagePaths is invalid." },
          { status: 400 },
        );
      }
      nextImagePaths = validatedRetainedPaths;
    } else {
      nextImagePaths = getDefaultRetainedImagePaths(current.options, currentPaths, options);
    }

    const validatedImages: ValidatedOptionImage[] = [];
    if (raw.optionImages.size > 0) {
      const { validateAndEncodeOptionImage } = await import(
        "@/lib/poll-option-image-processing"
      );
      for (const [optionIndex, file] of [...raw.optionImages.entries()].sort((a, b) => a[0] - b[0])) {
        validatedImages.push(await validateAndEncodeOptionImage(file, optionIndex));
      }
    }

    if (validatedImages.length > 0) {
      const sparseUploadedPaths = await uploadPollOptionImages(
        supabaseMutation,
        id,
        validatedImages,
      );
      uploadedPaths = sparseUploadedPaths.filter((path): path is string => Boolean(path));
      if (uploadedPaths.length !== validatedImages.length) {
        throw new PollOptionImageStorageError("Uploaded image path is missing.", uploadedPaths);
      }
      for (const image of validatedImages) {
        const uploadedPath = sparseUploadedPaths[image.optionIndex];
        if (!uploadedPath) {
          throw new PollOptionImageStorageError("Uploaded image path is missing.", uploadedPaths);
        }
        nextImagePaths[image.optionIndex] = uploadedPath;
      }
    }

    const storedImagePaths = nextImagePaths.some(Boolean) ? nextImagePaths : null;
    const { data: updatedPoll, error: updateError } = await supabaseMutation.rpc(
      "update_owned_poll",
      {
        p_poll_id: id,
        p_title: title,
        p_category: category,
        p_options: options,
        p_official_fact: officialFact || null,
        p_option_image_paths: storedImagePaths,
        p_expected_poll: {
          title: current.title,
          category: current.category,
          options: current.options,
          official_fact: current.official_fact,
          option_image_paths: current.option_image_paths,
        },
      },
    );

    if (updateError) {
      const cleanupError = await removePollOptionImages(supabaseMutation, uploadedPaths);
      uploadedPaths = [];
      if (cleanupError) logPublicMutationError("poll-owner-update-new-image-cleanup", cleanupError);

      const errorRecord = updateError as { code?: string; message?: string; details?: string };
      if (errorRecord.message === "POLL_STRUCTURE_LOCKED") {
        const lockReason = typeof errorRecord.details === "string"
          && STRUCTURAL_LOCK_REASONS.has(errorRecord.details)
          ? errorRecord.details
          : undefined;
        return NextResponse.json(
          {
            error: "설정된 수정 가능 조건이 종료되었거나 댓글이 있어 질문·선택지·이미지를 변경할 수 없습니다.",
            structural_edit_lock_reason: lockReason,
          },
          { status: 409 },
        );
      }
      if (errorRecord.message === "POLL_EDIT_CONFLICT") {
        return NextResponse.json(
          { error: "투표가 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도해주세요." },
          { status: 409 },
        );
      }
      if (errorRecord.code === "P0002" || errorRecord.message === "POLL_NOT_FOUND") {
        return NextResponse.json({ error: "poll not found." }, { status: 404 });
      }
      if (errorRecord.code === "22023" || errorRecord.message === "INVALID_POLL_INPUT") {
        return NextResponse.json({ error: "수정할 투표 내용을 확인해주세요." }, { status: 400 });
      }
      if (isOwnerMutationMigrationMissing(updateError)) {
        return NextResponse.json(
          { code: "POLL_OWNER_MUTATION_MIGRATION_REQUIRED", error: OWNER_MUTATION_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      logPublicMutationError("poll-owner-update-rpc", updateError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    const retainedPaths = new Set(nextImagePaths.filter((path): path is string => Boolean(path)));
    const oldPathsToRemove = currentPaths.filter(
      (path): path is string => Boolean(path) && !retainedPaths.has(path as string),
    );
    const oldCleanupError = await removePollOptionImages(supabaseMutation, oldPathsToRemove);
    if (oldCleanupError) {
      logPublicMutationError("poll-owner-update-old-image-cleanup", oldCleanupError);
    }

    return NextResponse.json(
      { ok: true, data: serializePublicPoll(updatedPoll) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const pathsToClean = error instanceof PollOptionImageStorageError
      ? [...new Set([...uploadedPaths, ...error.uploadedPaths])]
      : uploadedPaths;
    if (supabaseMutation && pathsToClean.length > 0) {
      const cleanupError = await removePollOptionImages(supabaseMutation, pathsToClean);
      if (cleanupError) logPublicMutationError("poll-owner-update-unexpected-cleanup", cleanupError);
    }

    if (error instanceof PollOwnerPatchRequestError || error instanceof PollOptionImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PollOptionImageStorageError) {
      logPublicMutationError("poll-owner-update-storage", error);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 502 });
    }

    logPublicMutationError("poll-owner-update-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.pollOwnerDelete);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    if (!validatePollId(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const authorization = await authorizePollOwner(request, id, supabaseMutation);
    if (!authorization.ok) {
      if (authorization.reason === "internal") {
        logPublicMutationError("poll-owner-delete-auth", authorization.error);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
      }
      return NextResponse.json(
        { error: authorization.reason === "not_found" ? "poll not found." : OWNER_FORBIDDEN_MESSAGE },
        { status: authorization.status },
      );
    }

    const result = await deletePollWithImageCleanup(supabaseMutation, id);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "poll not found." }, { status: 404 });
      }
      if (isOwnerMutationMigrationMissing(result.error)) {
        return NextResponse.json(
          { code: "POLL_OWNER_MUTATION_MIGRATION_REQUIRED", error: OWNER_MUTATION_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }
      logPublicMutationError("poll-owner-delete-rpc", result.error);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logPublicMutationError("poll-owner-delete-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
