import type { SupabaseClient } from "@supabase/supabase-js";

export const POLL_OPTION_IMAGES_BUCKET = "poll-option-images";

const STORED_OPTION_IMAGE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function getPollOptionImagePathsForDeletion(
  pollId: string,
  optionImagePaths: unknown,
): string[] {
  if (!pollId || pollId.includes("/") || !Array.isArray(optionImagePaths)) {
    return [];
  }

  const validPaths = new Set<string>();

  optionImagePaths.forEach((value, optionIndex) => {
    if (typeof value !== "string") return;

    const pathParts = value.split("/");
    if (
      pathParts.length !== 4
      || pathParts[0] !== pollId
      || pathParts[1] !== "options"
      || pathParts[2] !== String(optionIndex)
      || !STORED_OPTION_IMAGE_FILE_PATTERN.test(pathParts[3])
    ) {
      return;
    }

    validPaths.add(value);
  });

  return [...validPaths];
}

export async function removePollOptionImages(
  supabase: SupabaseClient,
  paths: string[],
): Promise<string | null> {
  if (paths.length === 0) return null;

  try {
    const { error } = await supabase.storage
      .from(POLL_OPTION_IMAGES_BUCKET)
      .remove(paths);
    return error?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type PollOptionImageCleanupLogger = (
  message: string,
  details: { pollId: string; imageCount: number; error: string },
) => void;

export async function cleanupPollOptionImagesAfterDeletion(
  supabase: SupabaseClient,
  pollId: string,
  paths: string[],
  logCleanupFailure: PollOptionImageCleanupLogger = console.error,
): Promise<void> {
  if (paths.length === 0) return;

  const cleanupError = await removePollOptionImages(supabase, paths);
  if (cleanupError) {
    logCleanupFailure("Failed to clean up poll option images after poll deletion.", {
      pollId,
      imageCount: paths.length,
      error: cleanupError,
    });
  }
}
