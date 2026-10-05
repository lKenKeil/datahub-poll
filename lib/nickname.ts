import { getUnicodeCodePointLength } from '@/lib/unicode-length';

const NICKNAME_CHARACTERS = /^[A-Za-z0-9_가-힣ㄱ-ㅎㅏ-ㅣ]+$/u;
const RESERVED_NICKNAMES = new Set([
  'admin', 'administrator', 'askio', '운영자', '관리자', '공식', 'official',
]);

export function validateNickname(value: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: '닉네임을 입력해주세요.' };
  }
  if (/[\u0000-\u001F\u007F-\u009F\p{Cf}]/u.test(value)) {
    return { ok: false, error: '닉네임에 사용할 수 없는 문자가 포함되어 있어요.' };
  }
  const nickname = value.trim();
  const length = getUnicodeCodePointLength(nickname);
  if (length < 2 || length > 16) {
    return { ok: false, error: '닉네임은 2~16자로 입력해주세요.' };
  }
  if (!NICKNAME_CHARACTERS.test(nickname)) {
    return { ok: false, error: '닉네임에는 한글, 영문, 숫자, 밑줄만 사용할 수 있어요.' };
  }
  if (RESERVED_NICKNAMES.has(nickname.toLowerCase())) {
    return { ok: false, error: '이 닉네임은 사용할 수 없어요.' };
  }
  return { ok: true, value: nickname };
}
