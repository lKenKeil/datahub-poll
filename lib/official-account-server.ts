import 'server-only';

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function getOfficialAccountUserId(): string | null {
  const userId = process.env.ASKIO_OFFICIAL_ACCOUNT_USER_ID?.trim();
  return userId && UUID_PATTERN.test(userId) ? userId.toLowerCase() : null;
}
