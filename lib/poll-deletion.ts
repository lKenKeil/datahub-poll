import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupPollOptionImagesAfterDeletion,
  getPollOptionImagePathsForDeletion,
} from "@/lib/poll-option-image-cleanup";

type DeletePollResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "internal"; error?: unknown };

export async function deletePollWithImageCleanup(
  supabase: SupabaseClient,
  pollId: string,
): Promise<DeletePollResult> {
  const { data, error } = await supabase.rpc("delete_poll_with_dependents", {
    p_poll_id: pollId,
  });

  if (error) {
    const errorRecord = error as { code?: string; message?: string };
    if (errorRecord.code === "P0002" || errorRecord.message === "POLL_NOT_FOUND") {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "internal", error };
  }

  const imagePaths = getPollOptionImagePathsForDeletion(pollId, data);
  const storedPathCount = Array.isArray(data)
    ? data.filter((value) => typeof value === "string").length
    : 0;
  if (storedPathCount > imagePaths.length) {
    console.warn("Skipped invalid poll option image paths during poll deletion.", {
      pollId,
      skippedPathCount: storedPathCount - imagePaths.length,
    });
  }
  await cleanupPollOptionImagesAfterDeletion(supabase, pollId, imagePaths);
  return { ok: true };
}
