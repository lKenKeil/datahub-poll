const UNSAFE_INPUT_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const LOG_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/gu;
const MAX_LOG_VALUE_LENGTH = 2_000;

export const PUBLIC_INTERNAL_ERROR_MESSAGE =
  "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";

type TextInputField = {
  label: string;
  value: string;
};

function toLogValue(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value)
    .replace(LOG_CONTROL_CHARACTERS, " ")
    .slice(0, MAX_LOG_VALUE_LENGTH);
}

export function hasUnsafeInputControlCharacters(value: string) {
  return UNSAFE_INPUT_CONTROL_CHARACTERS.test(value);
}

export function getUnsafeTextInputMessage(fields: TextInputField[]) {
  const invalidField = fields.find(({ value }) => hasUnsafeInputControlCharacters(value));
  return invalidField
    ? `${invalidField.label}에 사용할 수 없는 문자가 포함되어 있습니다.`
    : null;
}

export function logPublicMutationError(scope: string, error: unknown) {
  const errorRecord = error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;

  console.error(`[public mutation:${scope}]`, {
    name: toLogValue(errorRecord?.name),
    code: toLogValue(errorRecord?.code),
    message: toLogValue(errorRecord?.message ?? error),
    details: toLogValue(errorRecord?.details),
    hint: toLogValue(errorRecord?.hint),
  });
}
