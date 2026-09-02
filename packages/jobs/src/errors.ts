const DEFAULT_ERROR_CODE = "JOB_HANDLER_FAILED";
const DEFAULT_ERROR_REASON = "Job handler failed with an unknown error";
const MAX_ERROR_REASON_LENGTH = 4_000;

export class JobExecutionError extends Error {
  readonly code: string;
  override readonly cause: unknown;
  readonly retryable: boolean;

  constructor(input: {
    readonly cause?: unknown;
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  }) {
    super(input.message);
    this.name = "JobExecutionError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.cause = input.cause;
  }
}

export interface JobFailure {
  readonly code: string;
  readonly reason: string;
  readonly retryable: boolean;
}

const hasFailureContract = (
  error: unknown,
): error is { readonly code: string; readonly message: string; readonly retryable: boolean } =>
  error instanceof Error &&
  "code" in error &&
  typeof error.code === "string" &&
  "retryable" in error &&
  typeof error.retryable === "boolean";

const boundedReason = (reason: string): string => reason.slice(0, MAX_ERROR_REASON_LENGTH);

export const jobFailureFrom = (error: unknown): JobFailure => {
  if (error instanceof JobExecutionError || hasFailureContract(error)) {
    return Object.freeze({
      code: error.code,
      reason: boundedReason(error.message),
      retryable: error.retryable,
    });
  }
  if (error instanceof Error) {
    return Object.freeze({
      code: DEFAULT_ERROR_CODE,
      reason: DEFAULT_ERROR_REASON,
      retryable: true,
    });
  }
  return Object.freeze({
    code: DEFAULT_ERROR_CODE,
    reason: DEFAULT_ERROR_REASON,
    retryable: true,
  });
};
