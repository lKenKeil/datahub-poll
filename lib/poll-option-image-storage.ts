import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PollOptionImageStorageError,
  type ValidatedOptionImage,
} from "@/lib/poll-option-image-errors";
import { removePollOptionImages } from "@/lib/poll-option-image-cleanup";
import { POLL_OPTION_IMAGES_BUCKET } from "@/lib/poll-option-image-paths";

export { removePollOptionImages } from "@/lib/poll-option-image-cleanup";
export { POLL_OPTION_IMAGES_BUCKET } from "@/lib/poll-option-image-paths";

export async function uploadPollOptionImages(
  supabase: SupabaseClient,
  pollId: string,
  images: ValidatedOptionImage[],
): Promise<Array<string | null>> {
  const imagePaths: Array<string | null> = [];
  const uploadedPaths: string[] = [];

  try {
    for (const image of images) {
      const path = `${pollId}/options/${image.optionIndex}/${randomUUID()}.webp`;
      const { error } = await supabase.storage
        .from(POLL_OPTION_IMAGES_BUCKET)
        .upload(path, image.data, {
          cacheControl: "31536000",
          contentType: "image/webp",
          upsert: false,
        });

      if (error) {
        console.error("Poll option image upload failed:", error.message);
        throw new PollOptionImageStorageError("Failed to upload a poll option image.");
      }

      uploadedPaths.push(path);
      imagePaths[image.optionIndex] = path;
    }

    return imagePaths;
  } catch (error) {
    const cleanupError = await removePollOptionImages(supabase, uploadedPaths);
    if (cleanupError) {
      console.error("Failed to clean up partially uploaded poll option images:", cleanupError);
    }

    const pathsNeedingAnotherCleanupAttempt = cleanupError ? uploadedPaths : [];
    if (error instanceof PollOptionImageStorageError) {
      throw new PollOptionImageStorageError(error.message, pathsNeedingAnotherCleanupAttempt);
    }
    throw new PollOptionImageStorageError(
      "Failed to upload poll option images.",
      pathsNeedingAnotherCleanupAttempt,
    );
  }
}
