import "server-only";

export const MAX_POLL_OWNER_MULTIPART_BYTES = 4_400_000;
const OPTION_IMAGE_FIELD_PATTERN = /^optionImages\[(0|[1-9][0-9]*)\]$/;
const DESCRIPTION_FIELDS = ["officialFact", "official_fact", "description"] as const;

export type PollOwnerPatchRequest = {
  title?: unknown;
  category?: unknown;
  options?: unknown;
  officialFact?: unknown;
  retainedOptionImagePaths?: unknown;
  optionImages: Map<number, File>;
};

export class PollOwnerPatchRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PollOwnerPatchRequestError";
    this.status = status;
  }
}

function getOptionalFormString(formData: FormData, fieldName: string) {
  const values = formData.getAll(fieldName);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new PollOwnerPatchRequestError(`${fieldName} must be a single string value.`);
  }
  return values[0];
}

function getDescriptionValue(
  source: Record<string, unknown>,
  hasField: (fieldName: string) => boolean,
) {
  const present = DESCRIPTION_FIELDS.filter(hasField);
  if (present.length > 1) {
    throw new PollOwnerPatchRequestError("Use only one description field.");
  }
  return present.length === 1 ? source[present[0]] : undefined;
}

function parseOptionalJson(value: string | undefined, fieldName: string) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new PollOwnerPatchRequestError(`${fieldName} must contain valid JSON.`);
  }
}

export async function parsePollOwnerPatchRequest(
  request: Request,
): Promise<PollOwnerPatchRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";

  if (mediaType === "" || mediaType === "application/json" || mediaType.endsWith("+json")) {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON body must be an object.");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      throw new PollOwnerPatchRequestError("invalid JSON body.");
    }

    const allowedFields = new Set([
      "title",
      "category",
      "options",
      "officialFact",
      "official_fact",
      "description",
      "retainedOptionImagePaths",
    ]);
    if (Object.keys(body).some((fieldName) => !allowedFields.has(fieldName))) {
      throw new PollOwnerPatchRequestError("unexpected field in request body.");
    }

    return {
      title: body.title,
      category: body.category,
      options: body.options,
      officialFact: getDescriptionValue(body, (fieldName) => (
        Object.prototype.hasOwnProperty.call(body, fieldName)
      )),
      retainedOptionImagePaths: body.retainedOptionImagePaths,
      optionImages: new Map(),
    };
  }

  if (mediaType !== "multipart/form-data") {
    throw new PollOwnerPatchRequestError(
      "Content-Type must be application/json or multipart/form-data.",
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_POLL_OWNER_MULTIPART_BYTES) {
    throw new PollOwnerPatchRequestError("multipart request must be at most 4.4MB.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new PollOwnerPatchRequestError("invalid multipart form body.");
  }

  const allowedTextFields = new Set([
    "title",
    "category",
    "options",
    "officialFact",
    "official_fact",
    "description",
    "retainedOptionImagePaths",
  ]);
  const optionImages = new Map<number, File>();
  let approximateBodyBytes = 0;

  for (const [fieldName, value] of formData.entries()) {
    approximateBodyBytes += typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : value.size;

    if (allowedTextFields.has(fieldName)) {
      if (typeof value !== "string") {
        throw new PollOwnerPatchRequestError(`${fieldName} must be a string.`);
      }
      continue;
    }

    const match = OPTION_IMAGE_FIELD_PATTERN.exec(fieldName);
    if (!match || !(value instanceof File)) {
      throw new PollOwnerPatchRequestError("unexpected multipart field.");
    }

    const optionIndex = Number(match[1]);
    if (!Number.isSafeInteger(optionIndex) || optionImages.has(optionIndex)) {
      throw new PollOwnerPatchRequestError("duplicate or invalid image index.");
    }
    optionImages.set(optionIndex, value);
  }

  if (approximateBodyBytes > MAX_POLL_OWNER_MULTIPART_BYTES) {
    throw new PollOwnerPatchRequestError("multipart request must be at most 4.4MB.", 413);
  }

  const source: Record<string, unknown> = {};
  for (const fieldName of DESCRIPTION_FIELDS) {
    const value = getOptionalFormString(formData, fieldName);
    if (value !== undefined) source[fieldName] = value;
  }

  return {
    title: getOptionalFormString(formData, "title"),
    category: getOptionalFormString(formData, "category"),
    options: parseOptionalJson(getOptionalFormString(formData, "options"), "options"),
    officialFact: getDescriptionValue(source, (fieldName) => formData.has(fieldName)),
    retainedOptionImagePaths: parseOptionalJson(
      getOptionalFormString(formData, "retainedOptionImagePaths"),
      "retainedOptionImagePaths",
    ),
    optionImages,
  };
}
