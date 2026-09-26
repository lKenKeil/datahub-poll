import { NextResponse } from "next/server";
import { getSupabaseMutationClient, supabaseServer } from "@/lib/supabase-server";
import { isValidVoterId } from "@/lib/voter-id";
import type { PollCategory } from "@/lib/types";
import { authorizePollOwner } from "@/lib/poll-owner-auth";
import {
  parsePollOwnerPatchRequest,
  PollOwnerPatchRequestError,
} from "@/lib/poll-owner-update";
import {
  PollOptionImageStorageError,
  PollOptionImageValidationError,
  removePollOptionImages,
  uploadPollOptionImages,
  validateAndEncodeOptionImage,
  type ValidatedOptionImage,
} from "@/lib/poll-option-images";
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

type MutablePollRow = {
  id: string;
  title: string;
  category: PollCategory;
  options: string[];
  votes: number[];
  participants: number | null;
  official_fact: string | null;
  option_image_paths: unknown;
  created_at?: string;
};

function isOwnerMutationMigrationMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  return record.code === "PGRST202"
    || ((record.code === "42883" || record.code === "42P01")
      && Boolean(record.message?.includes("owned_poll") || record.message?.includes("delete_poll_with_dependents")));
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

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const userFingerprint = _.headers.get("x-user-fp")?.trim() ?? "";
  const voterId = _.headers.get("x-voter-id")?.trim().toLowerCase() ?? "";

  if (voterId && !isValidVoterId(voterId)) {
    return NextResponse.json({ error: "invalid voter id." }, { status: 400 });
  }

  const [{ data: poll, error: pollError }, { data: comments, error: commentsError }] = await Promise.all([
    supabaseServer.from("polls").select("*").eq("id", id).maybeSingle(),
    supabaseServer
      .from("comments")
      .select("*")
      .eq("poll_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (pollError) {
    return NextResponse.json({ error: pollError.message }, { status: 500 });
  }

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  let viewerVote: { optionIndex: number } | null = null;
  if (voterId) {
    const supabaseMutation = getSupabaseMutationClient();
    const { data: vote, error: voteError } = await supabaseMutation
      .from("poll_votes")
      .select("option_index")
      .eq("poll_id", id)
      .eq("voter_id", voterId)
      .maybeSingle();

    if (voteError) {
      return NextResponse.json({ error: voteError.message }, { status: 500 });
    }

    if (vote && Number.isInteger(vote.option_index)) {
      viewerVote = { optionIndex: vote.option_index };
    }
  }

  const commentRows = (comments ?? []) as Array<Record<string, unknown>>;
  const commentIds = commentRows.map((row) => String(row.id));

  if (commentIds.length === 0) {
    return NextResponse.json({ poll: poll ?? null, comments: [], viewerVote });
  }

  const { data: reactions, error: reactionsError } = await supabaseServer
    .from("comment_reactions")
    .select("comment_id,reaction,user_fingerprint")
    .in("comment_id", commentIds);

  if (reactionsError) {
    return NextResponse.json({ error: reactionsError.message }, { status: 500 });
  }

  const reactionRows = (reactions ?? []) as Array<{
    comment_id: string;
    reaction: "like" | "dislike";
    user_fingerprint: string;
  }>;

  const byComment = new Map<string, { like: number; dislike: number; userReaction: "like" | "dislike" | null }>();

  for (const commentId of commentIds) {
    byComment.set(commentId, { like: 0, dislike: 0, userReaction: null });
  }

  for (const row of reactionRows) {
    const bucket = byComment.get(row.comment_id);
    if (!bucket) continue;

    if (row.reaction === "like") bucket.like += 1;
    if (row.reaction === "dislike") bucket.dislike += 1;

    if (userFingerprint && row.user_fingerprint === userFingerprint) {
      bucket.userReaction = row.reaction;
    }
  }

  const enriched = commentRows.map((row) => {
    const key = String(row.id);
    const meta = byComment.get(key) ?? { like: 0, dislike: 0, userReaction: null };
    return {
      ...row,
      parent_id: (row.parent_id as string | null | undefined) ?? null,
      like_count: meta.like,
      dislike_count: meta.dislike,
      user_reaction: meta.userReaction,
    };
  });

  return NextResponse.json({ poll: poll ?? null, comments: enriched, viewerVote });
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
      .select("id,title,category,options,votes,participants,official_fact,option_image_paths,created_at")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      logPublicMutationError("poll-owner-update-read", currentError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }
    if (!currentData) {
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
    for (const [optionIndex, file] of [...raw.optionImages.entries()].sort((a, b) => a[0] - b[0])) {
      validatedImages.push(await validateAndEncodeOptionImage(file, optionIndex));
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

      const errorRecord = updateError as { code?: string; message?: string };
      if (errorRecord.message === "POLL_STRUCTURE_LOCKED") {
        return NextResponse.json(
          { error: "참여 또는 댓글이 있는 투표는 질문·선택지·이미지를 변경할 수 없습니다." },
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
      { ok: true, data: updatedPoll },
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
