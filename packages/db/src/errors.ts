export class PersistenceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.cause = cause;
  }
}

export class RawItemIdentityConflictError extends PersistenceError {
  constructor(message: string) {
    super("RAW_ITEM_IDENTITY_CONFLICT", message);
    this.name = "RawItemIdentityConflictError";
  }
}
