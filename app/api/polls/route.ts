import { NextResponse } from "next/server";
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
  removePollOptionImages,
  uploadPollOptionImages,
  validateAndEncodeOptionImage,
  type ValidatedOptionImage,
} from "@/lib/poll-option-images";
import { createPollOwnerCredential } from "@/lib/poll-owner-token";

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

  return {
    title: getOneFormString(formData, "title"),
    category: getOneFormString(formData, "category"),
    options,
    officialFact: getMultipartOfficialFact(formData),
    optionImages,
  };
}

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("polls")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `polls GET failed: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.pollCreate);
  if (rateLimitResponse) return rateLimitResponse;

  let uploadedPaths: string[] = [];
  let supabaseMutation: ReturnType<typeof getSupabaseMutationClient> | null = null;
  let pollInserted = false;

  try {
    const raw = await parsePollCreateRequest(request);

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

    if (rawTitle.length < 3 || rawTitle.length > 120) {
      return NextResponse.json({ error: "title must be 3-120 chars." }, { status: 400 });
    }

    if (!validCategories.has(rawCategory)) {
      return NextResponse.json({ error: "invalid category." }, { status: 400 });
    }

    if (rawOptions.length < 2 || rawOptions.length > 6 || rawOptions.some((opt) => !opt || opt.length > 50)) {
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
    if (officialFact.length > 300) {
      return NextResponse.json({ error: "official_fact must be at most 300 chars." }, { status: 400 });
    }

    for (const optionIndex of raw.optionImages.keys()) {
      if (optionIndex < 0 || optionIndex >= rawOptions.length) {
        return NextResponse.json(
          { error: `optionImages[${optionIndex}] does not match an option.` },
          { status: 400 },
        );
      }
    }

    const validatedImages: ValidatedOptionImage[] = [];
    for (const [optionIndex, file] of [...raw.optionImages.entries()].sort((a, b) => a[0] - b[0])) {
      validatedImages.push(await validateAndEncodeOptionImage(file, optionIndex));
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

    const { error } = await supabaseMutation.rpc("create_owned_poll", {
      p_poll_id: id,
      p_title: rawTitle,
      p_category: rawCategory,
      p_options: rawOptions,
      p_votes: insertPayload.votes,
      p_participants: insertPayload.participants,
      p_official_fact: officialFact || null,
      p_option_image_paths: insertPayload.option_image_paths ?? null,
      p_owner_token_hash: ownerCredential.hash,
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
        ? { id, ownerToken: ownerCredential.token, option_image_paths: insertPayload.option_image_paths }
        : { id, ownerToken: ownerCredential.token },
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
