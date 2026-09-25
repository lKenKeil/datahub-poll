import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getValidatedPollOptionImagePath,
  POLL_OPTION_IMAGES_BUCKET,
} from "@/lib/poll-option-image-paths";

export { POLL_OPTION_IMAGES_BUCKET } from "@/lib/poll-option-image-paths";

export function getPollOptionImagePathsForDeletion(
  pollId: string,
  optionImagePaths: unknown,
): string[] {
  if (!pollId || pollId.includes("/") || !Array.isArray(optionImagePaths)) {
    return [];
  }

  const validPaths = new Set<string>();

  optionImagePaths.forEach((value, optionIndex) => {
    const path = getValidatedPollOptionImagePath(
      pollId,
      optionIndex,
      typeof value === "string" ? value : null,
    );
    if (path) validPaths.add(path);
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
