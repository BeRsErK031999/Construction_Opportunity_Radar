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

export class NormalizationIdentityConflictError extends PersistenceError {
  constructor(message: string) {
    super("NORMALIZATION_IDENTITY_CONFLICT", message);
    this.name = "NormalizationIdentityConflictError";
  }
}

export class DeduplicationIdentityConflictError extends PersistenceError {
  constructor(message: string) {
    super("DEDUPLICATION_IDENTITY_CONFLICT", message);
    this.name = "DeduplicationIdentityConflictError";
  }
}

export class ClassificationIdentityConflictError extends PersistenceError {
  constructor(message: string) {
    super("CLASSIFICATION_IDENTITY_CONFLICT", message);
    this.name = "ClassificationIdentityConflictError";
  }
}
