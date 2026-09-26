import "server-only";

import sharp from "sharp";
import {
  PollOptionImageValidationError,
  type ValidatedOptionImage,
} from "@/lib/poll-option-image-errors";

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
