import 'server-only';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export class AvatarInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function encodeProfileAvatar(file: File) {
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw new AvatarInputError('사진은 2MB 이하로 선택해주세요.', file.size ? 413 : 400);
  const input = Buffer.from(await file.arrayBuffer());
  const format = input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg'
    : input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format || file.type !== `image/${format}`) throw new AvatarInputError('JPEG, PNG, WebP 사진만 사용할 수 있어요.');
  const { default: sharp } = await import('sharp');
  try {
    const options = { failOn: 'error' as const, limitInputPixels: 16_000_000 };
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error('Invalid image');
    // Fresh encoding without withMetadata removes EXIF and other private data.
    return await sharp(input, options).rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  } catch { throw new AvatarInputError('사진을 읽을 수 없어요. 다른 사진을 선택해주세요.'); }
}
