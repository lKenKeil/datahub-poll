import "server-only";

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
