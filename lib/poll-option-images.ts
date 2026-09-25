import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  removePollOptionImages,
} from "@/lib/poll-option-image-cleanup";
import { POLL_OPTION_IMAGES_BUCKET } from "@/lib/poll-option-image-paths";

export {
  removePollOptionImages,
} from "@/lib/poll-option-image-cleanup";
export { POLL_OPTION_IMAGES_BUCKET } from "@/lib/poll-option-image-paths";
export const MAX_OPTION_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_OPTION_IMAGE_WIDTH = 4096;
export const MAX_OPTION_IMAGE_HEIGHT = 4096;
export const MAX_OPTION_IMAGE_PIXELS = 16_000_000;

const WEBP_QUALITY = 82;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type DetectedImage = {
  format: "jpeg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type ValidatedOptionImage = {
  optionIndex: number;
  data: Buffer;
};

export class PollOptionImageValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PollOptionImageValidationError";
    this.status = status;
  }
}

export class PollOptionImageStorageError extends Error {
  readonly uploadedPaths: string[];

  constructor(message: string, uploadedPaths: string[] = []) {
    super(message);
    this.name = "PollOptionImageStorageError";
    this.uploadedPaths = uploadedPaths;
  }
}

function detectImage(buffer: Buffer): DetectedImage | null {
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return { format: "jpeg", mimeType: "image/jpeg" };
  }

  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { format: "png", mimeType: "image/png" };
  }

  if (
    buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { format: "webp", mimeType: "image/webp" };
  }

  return null;
}

export async function validateAndEncodeOptionImage(
  file: File,
  optionIndex: number,
): Promise<ValidatedOptionImage> {
  if (file.size <= 0) {
    throw new PollOptionImageValidationError(`optionImages[${optionIndex}] is empty.`);
  }

  if (file.size > MAX_OPTION_IMAGE_BYTES) {
    throw new PollOptionImageValidationError(
      `optionImages[${optionIndex}] must be at most 2MB.`,
      413,
    );
  }

  const claimedMimeType = file.type.trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(claimedMimeType)) {
    throw new PollOptionImageValidationError(
      `optionImages[${optionIndex}] must be a JPEG, PNG, or WebP image.`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(input);
  if (!detected || detected.mimeType !== claimedMimeType) {
    throw new PollOptionImageValidationError(
      `optionImages[${optionIndex}] content does not match its MIME type.`,
    );
  }

  try {
    const metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_OPTION_IMAGE_PIXELS,
      sequentialRead: true,
    }).metadata();

    if (
      metadata.format !== detected.format
      || !metadata.width
      || !metadata.height
      || (metadata.pages ?? 1) !== 1
    ) {
      throw new PollOptionImageValidationError(
        `optionImages[${optionIndex}] is not a supported single-frame image.`,
      );
    }

    if (
      metadata.width > MAX_OPTION_IMAGE_WIDTH
      || metadata.height > MAX_OPTION_IMAGE_HEIGHT
      || metadata.width * metadata.height > MAX_OPTION_IMAGE_PIXELS
    ) {
      throw new PollOptionImageValidationError(
        `optionImages[${optionIndex}] must be at most 4096x4096 and 16 megapixels.`,
      );
    }

    const output = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_OPTION_IMAGE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (
      output.info.width > MAX_OPTION_IMAGE_WIDTH
      || output.info.height > MAX_OPTION_IMAGE_HEIGHT
      || output.info.width * output.info.height > MAX_OPTION_IMAGE_PIXELS
    ) {
      throw new PollOptionImageValidationError(
        `optionImages[${optionIndex}] exceeds the decoded image limit.`,
      );
    }

    if (output.data.length > MAX_OPTION_IMAGE_BYTES) {
      throw new PollOptionImageValidationError(
        `optionImages[${optionIndex}] is larger than 2MB after safe encoding.`,
        413,
      );
    }

    return { optionIndex, data: output.data };
  } catch (error) {
    if (error instanceof PollOptionImageValidationError) throw error;
    throw new PollOptionImageValidationError(
      `optionImages[${optionIndex}] could not be decoded as a valid image.`,
    );
  }
}

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
