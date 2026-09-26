export function getUnicodeCodePointLength(value: string) {
  return Array.from(value).length;
}

export function isUnicodeLengthBetween(
  value: string,
  minimum: number,
  maximum: number,
) {
  const length = getUnicodeCodePointLength(value);
  return length >= minimum && length <= maximum;
}
