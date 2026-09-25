import type { SupabaseClient } from "@supabase/supabase-js";

export const POLL_OPTION_IMAGES_BUCKET = "poll-option-images";

const STORED_OPTION_IMAGE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function normalizeOptionImagePaths(value: unknown, optionCount: number) {
  if (!Array.isArray(value) || value.length !== optionCount) return null;
  return value.map((path) => (typeof path === "string" && path ? path : null));
}

export function getValidatedPollOptionImagePath(
  pollId: string,
  optionIndex: number,
  objectPath: string | null | undefined,
) {
  if (!pollId || pollId.includes("/") || !objectPath) return null;

  const pathParts = objectPath.split("/");
  if (
    pathParts.length !== 4
    || pathParts[0] !== pollId
    || pathParts[1] !== "options"
    || pathParts[2] !== String(optionIndex)
    || !STORED_OPTION_IMAGE_FILE_PATTERN.test(pathParts[3])
  ) {
    return null;
  }

  return objectPath;
}

export function getPollOptionImagePublicUrl(
  supabase: SupabaseClient,
  pollId: string,
  optionIndex: number,
  objectPath: string | null | undefined,
) {
  const validatedPath = getValidatedPollOptionImagePath(pollId, optionIndex, objectPath);
  if (!validatedPath) return null;

  return supabase.storage
    .from(POLL_OPTION_IMAGES_BUCKET)
    .getPublicUrl(validatedPath).data.publicUrl;
}
