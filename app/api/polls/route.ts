import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth-server";
import { randomUUID } from "node:crypto";
import { getSupabaseMutationClient, supabaseServer } from "@/lib/supabase-server";
import { PollCategory } from "@/lib/types";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  getUnsafeTextInputMessage,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";
import {
  PollOptionImageStorageError,
  PollOptionImageValidationError,
  type ValidatedOptionImage,
} from "@/lib/poll-option-image-errors";
import {
  removePollOptionImages,
  uploadPollOptionImages,
} from "@/lib/poll-option-image-storage";
import { createPollOwnerCredential } from "@/lib/poll-owner-token";
import { getUnicodeCodePointLength } from "@/lib/unicode-length";
import {
  parsePollEditLockConfig,
  type PollEditLockConfig,
} from "@/lib/poll-edit-lock";
import { isModerationMigrationMissing, moderationErrorResponse } from "@/lib/content-report-server";
import { PUBLIC_POLL_COLUMNS, serializePublicPoll } from "@/lib/public-identity";

const validCategories = new Set<PollCategory>(["학술/통계", "IT/테크", "사회/경제", "라이프스타일", "커뮤니티"]);
const MAX_MULTIPART_REQUEST_BYTES = 4_400_000;
const OPTION_IMAGE_FIELD_PATTERN = /^optionImages\[(0|[1-9][0-9]*)\]$/;
const OWNERSHIP_MIGRATION_ERROR_MESSAGE =
  "투표 소유권 설정이 아직 적용되지 않았습니다. 관리자에게 문의해주세요.";

export const runtime = "nodejs";

type PollCreateRequest = {
  title: unknown;
  category: unknown;
  options: unknown;
  officialFact: unknown;
  editLock: unknown;
  isAnonymous: unknown;
  optionImages: Map<number, File>;
};

class PollCreateRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PollCreateRequestError";
    this.status = status;
  }
}

function isOwnershipMigrationMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const errorRecord = error as Record<string, unknown>;
  const code = typeof errorRecord.code === "string" ? errorRecord.code : "";
  const message = typeof errorRecord.message === "string" ? errorRecord.message : "";
  return (
    code === "PGRST202"
    || ((code === "42883" || code === "42P01")
      && (message.includes("create_owned_poll") || message.includes("poll_ownership")))
  );
}

function getOneFormString(formData: FormData, fieldName: string): string;
function getOneFormString(formData: FormData, fieldName: string, required: true): string;
function getOneFormString(formData: FormData, fieldName: string, required: false): string | undefined;
function getOneFormString(formData: FormData, fieldName: string, required = true) {
  const values = formData.getAll(fieldName);
  if (values.length === 0) {
    if (!required) return undefined;
    throw new PollCreateRequestError(`${fieldName} is required.`);
  }
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new PollCreateRequestError(`${fieldName} must be a single string value.`);
  }
  return values[0];
}

function getMultipartOfficialFact(formData: FormData) {
  const aliases = ["officialFact", "official_fact", "description"];
  const presentAliases = aliases.filter((fieldName) => formData.has(fieldName));
  if (presentAliases.length > 1) {
    throw new PollCreateRequestError("Use only one description field.");
  }
  return presentAliases.length === 1
    ? getOneFormString(formData, presentAliases[0], false)
    : undefined;
}

async function parsePollCreateRequest(request: Request): Promise<PollCreateRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";

  if (mediaType === "" || mediaType === "application/json" || mediaType.endsWith("+json")) {
    let raw: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON body must be an object.");
      }
      raw = parsed as Record<string, unknown>;
    } catch {
      throw new PollCreateRequestError("invalid JSON body.");
    }

    const descriptionAliases = ["official_fact", "officialFact", "description"] as const;
    const presentAliases = descriptionAliases.filter((fieldName) => (
      Object.prototype.hasOwnProperty.call(raw, fieldName)
    ));
    if (presentAliases.length > 1) {
      throw new PollCreateRequestError("Use only one description field.");
    }
    const officialFact = presentAliases.length === 1 ? raw[presentAliases[0]] : undefined;
    return {
      title: raw.title,
      category: raw.category,
      options: raw.options,
      officialFact,
      editLock: raw.editLock,
      isAnonymous: raw.isAnonymous,
      optionImages: new Map(),
    };
  }

  if (mediaType !== "multipart/form-data") {
    throw new PollCreateRequestError(
      "Content-Type must be application/json or multipart/form-data.",
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new PollCreateRequestError("multipart request must be at most 4.4MB.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new PollCreateRequestError("invalid multipart form body.");
  }

  const allowedTextFields = new Set([
    "title",
    "category",
    "options",
    "officialFact",
    "official_fact",
    "description",
    "editLock",
    "isAnonymous",
  ]);
  const optionImages = new Map<number, File>();
  let approximateBodyBytes = 0;

  for (const [fieldName, value] of formData.entries()) {
    approximateBodyBytes += typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : value.size;

    if (allowedTextFields.has(fieldName)) {
      if (typeof value !== "string") {
        throw new PollCreateRequestError(`${fieldName} must be a string.`);
      }
      continue;
    }

    const match = OPTION_IMAGE_FIELD_PATTERN.exec(fieldName);
    if (!match || !(value instanceof File)) {
      throw new PollCreateRequestError("unexpected multipart field.");
    }

    const optionIndex = Number(match[1]);
    if (!Number.isSafeInteger(optionIndex) || optionImages.has(optionIndex)) {
      throw new PollCreateRequestError("duplicate or invalid image index.");
    }
    optionImages.set(optionIndex, value);
  }

  if (approximateBodyBytes > MAX_MULTIPART_REQUEST_BYTES) {
    throw new PollCreateRequestError("multipart request must be at most 4.4MB.", 413);
  }

  const optionsText = getOneFormString(formData, "options");
  let options: unknown;
  try {
    options = JSON.parse(optionsText);
  } catch {
    throw new PollCreateRequestError("options must be a JSON string array.");
  }

  const editLockText = getOneFormString(formData, "editLock", false);
  let editLock: unknown;
  if (editLockText !== undefined) {
    try {
      editLock = JSON.parse(editLockText);
    } catch {
      throw new PollCreateRequestError("editLock must contain valid JSON.");
    }
  }

  const anonymousText = getOneFormString(formData, "isAnonymous", false);
  if (anonymousText !== undefined && anonymousText !== "true" && anonymousText !== "false") {
    throw new PollCreateRequestError("isAnonymous must be a boolean.");
  }

  return {
    title: getOneFormString(formData, "title"),
    category: getOneFormString(formData, "category"),
    options,
    officialFact: getMultipartOfficialFact(formData),
    editLock,
    isAnonymous: anonymousText === "true",
    optionImages,
  };
}

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("polls")
      .select(PUBLIC_POLL_COLUMNS)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });

    if (error) {
      if (isModerationMigrationMissing(error)) return moderationErrorResponse(error, "poll-list-read");
      logPublicMutationError("poll-list-read", error);
      return NextResponse.json(
        { error: PUBLIC_INTERNAL_ERROR_MESSAGE },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Only IDs leave this privileged query. Static official fallback must not
    // resurrect a question that moderation has hidden in the database.
    const supabaseMutation = getSupabaseMutationClient();
    const [{ data: hiddenPolls, error: hiddenPollsError }, { data: deletedOfficialPolls, error: deletedOfficialError }] = await Promise.all([
      supabaseMutation.from("polls").select("id").eq("is_hidden", true),
      supabaseMutation.from("deleted_official_polls").select("poll_id"),
    ]);
    if (hiddenPollsError) {
      if (isModerationMigrationMissing(hiddenPollsError)) return moderationErrorResponse(hiddenPollsError, "poll-list-hidden-state");
      logPublicMutationError("poll-list-hidden-state", hiddenPollsError);
      return NextResponse.json(
        { error: PUBLIC_INTERNAL_ERROR_MESSAGE },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (deletedOfficialError) return moderationErrorResponse(deletedOfficialError, "poll-list-deleted-official-state");

    const hiddenIds = new Set((hiddenPolls ?? []).map((poll) => String(poll.id)));
    const unavailableIds = new Set([
      ...hiddenIds,
      ...(deletedOfficialPolls ?? []).map((poll) => String(poll.poll_id)),
    ]);
    return NextResponse.json({
      data: (data ?? []).filter((poll) => !unavailableIds.has(String(poll.id))).map(serializePublicPoll),
      unavailableOfficialPollIds: [...unavailableIds].filter((id) => id.startsWith("official_")),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logPublicMutationError("poll-list-unexpected", error);
    return NextResponse.json(
      { error: PUBLIC_INTERNAL_ERROR_MESSAGE },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.pollCreate);
  if (rateLimitResponse) return rateLimitResponse;

  let uploadedPaths: string[] = [];
  let supabaseMutation: ReturnType<typeof getSupabaseMutationClient> | null = null;
  let pollInserted = false;

  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    const raw = await parsePollCreateRequest(request);
    if (raw.isAnonymous !== undefined && typeof raw.isAnonymous !== "boolean") {
      return NextResponse.json({ error: "isAnonymous must be a boolean." }, { status: 400 });
    }

    const rawTitleInput = typeof raw?.title === "string" ? raw.title : "";
    const rawOptionInputs = Array.isArray(raw?.options) && raw.options.every((value) => typeof value === "string")
      ? raw.options as string[]
      : [];
    const rawOfficialFactInput = typeof raw.officialFact === "string" ? raw.officialFact : "";
    const unsafeInputMessage = getUnsafeTextInputMessage([
      { label: "투표 질문", value: rawTitleInput },
      ...rawOptionInputs.map((value, index) => ({ label: `선택지 ${index + 1}`, value })),
      { label: "설명 또는 참고정보", value: rawOfficialFactInput },
    ]);
    if (unsafeInputMessage) {
      return NextResponse.json({ error: unsafeInputMessage }, { status: 400 });
    }

    const rawTitle = rawTitleInput.trim();
    const rawCategory = (typeof raw?.category === "string" ? raw.category.trim() : "") as PollCategory;
    const rawOptions = rawOptionInputs.map((value) => value.trim());

    const titleLength = getUnicodeCodePointLength(rawTitle);
    if (titleLength < 3 || titleLength > 120) {
      return NextResponse.json({ error: "title must be 3-120 chars." }, { status: 400 });
    }

    if (!validCategories.has(rawCategory)) {
      return NextResponse.json({ error: "invalid category." }, { status: 400 });
    }

    if (
      rawOptions.length < 2
      || rawOptions.length > 6
      || rawOptions.some((opt) => !opt || getUnicodeCodePointLength(opt) > 50)
    ) {
      return NextResponse.json({ error: "options must be 2-6 values of 1-50 chars." }, { status: 400 });
    }

    const uniqueOptions = new Set(rawOptions.map((option) => option.toLowerCase()));
    if (uniqueOptions.size !== rawOptions.length) {
      return NextResponse.json({ error: "options must be unique." }, { status: 400 });
    }

    if (raw.officialFact !== undefined && typeof raw.officialFact !== "string") {
      return NextResponse.json({ error: "official_fact must be a string." }, { status: 400 });
    }

    const officialFact = typeof raw.officialFact === "string" ? raw.officialFact.trim() : "";
    if (getUnicodeCodePointLength(officialFact) > 300) {
      return NextResponse.json({ error: "official_fact must be at most 300 chars." }, { status: 400 });
    }

    const editLockResult = parsePollEditLockConfig(raw.editLock);
    if (!editLockResult.ok) {
      return NextResponse.json({ error: editLockResult.error }, { status: 400 });
    }
    const editLock: PollEditLockConfig = editLockResult.value;

    for (const optionIndex of raw.optionImages.keys()) {
      if (optionIndex < 0 || optionIndex >= rawOptions.length) {
        return NextResponse.json(
          { error: `optionImages[${optionIndex}] does not match an option.` },
          { status: 400 },
        );
      }
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

    const id = `custom_${randomUUID()}`;
    const ownerCredential = createPollOwnerCredential();

    const insertPayload: Record<string, unknown> = {
      id,
      title: rawTitle,
      category: rawCategory,
      options: rawOptions,
      votes: Array(rawOptions.length).fill(0),
      participants: 0,
    };

    if (officialFact) {
      insertPayload.official_fact = officialFact;
    }

    supabaseMutation = getSupabaseMutationClient();
    if (validatedImages.length > 0) {
      const sparseImagePaths = await uploadPollOptionImages(supabaseMutation, id, validatedImages);
      uploadedPaths = sparseImagePaths.filter((path): path is string => Boolean(path));
      if (uploadedPaths.length !== validatedImages.length) {
        throw new PollOptionImageStorageError("Uploaded image path is missing.");
      }

      const optionImagePaths = Array<string | null>(rawOptions.length).fill(null);
      for (const image of validatedImages) {
        const path = sparseImagePaths[image.optionIndex];
        if (!path) throw new PollOptionImageStorageError("Uploaded image path is missing.");
        optionImagePaths[image.optionIndex] = path;
      }

      insertPayload.option_image_paths = optionImagePaths;
    }

    const { error } = await supabaseMutation.rpc("create_owned_poll_with_author", {
      p_poll_id: id,
      p_title: rawTitle,
      p_category: rawCategory,
      p_options: rawOptions,
      p_votes: insertPayload.votes,
      p_participants: insertPayload.participants,
      p_official_fact: officialFact || null,
      p_option_image_paths: insertPayload.option_image_paths ?? null,
      p_owner_token_hash: ownerCredential.hash,
      p_edit_lock_mode: editLock.mode,
      p_edit_lock_minutes: editLock.minutes,
      p_edit_lock_participants: editLock.participants,
      p_author_user_id: auth.user.id,
      p_is_anonymous: raw.isAnonymous === true,
    });

    if (error) {
      logPublicMutationError("poll-create-owned-rpc", error);
      const cleanupError = await removePollOptionImages(supabaseMutation, uploadedPaths);
      uploadedPaths = [];
      if (cleanupError) {
        logPublicMutationError("poll-create-db-failure-cleanup", cleanupError);
      }
      return NextResponse.json(
        {
          code: isOwnershipMigrationMissing(error) ? "POLL_OWNERSHIP_MIGRATION_REQUIRED" : undefined,
          error: isOwnershipMigrationMissing(error)
            ? OWNERSHIP_MIGRATION_ERROR_MESSAGE
            : PUBLIC_INTERNAL_ERROR_MESSAGE,
        },
        { status: isOwnershipMigrationMissing(error) ? 503 : 500 },
      );
    }

    pollInserted = true;
    return NextResponse.json({
      ok: true,
      data: uploadedPaths.length > 0
        ? {
          id,
          ownerToken: ownerCredential.token,
          option_image_paths: insertPayload.option_image_paths,
          edit_lock_mode: editLock.mode,
          edit_lock_minutes: editLock.minutes,
          edit_lock_participants: editLock.participants,
        }
        : {
          id,
          ownerToken: ownerCredential.token,
          edit_lock_mode: editLock.mode,
          edit_lock_minutes: editLock.minutes,
          edit_lock_participants: editLock.participants,
        },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const pathsToClean = error instanceof PollOptionImageStorageError
      ? [...new Set([...uploadedPaths, ...error.uploadedPaths])]
      : uploadedPaths;

    if (!pollInserted && supabaseMutation && pathsToClean.length > 0) {
      const cleanupError = await removePollOptionImages(supabaseMutation, pathsToClean);
      if (cleanupError) {
        logPublicMutationError("poll-create-unexpected-cleanup", cleanupError);
      }
    }

    if (error instanceof PollCreateRequestError || error instanceof PollOptionImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PollOptionImageStorageError) {
      logPublicMutationError("poll-create-storage", error);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 502 });
    }

    logPublicMutationError("poll-create-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
