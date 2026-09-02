export type SourceIngestionErrorCode =
  | "SOURCE_ADAPTER_CURSOR_LOOP"
  | "SOURCE_ADAPTER_MISMATCH"
  | "SOURCE_ADAPTER_UNSUPPORTED"
  | "SOURCE_COLLECTION_NOT_PERMITTED";

export class SourceIngestionError extends Error {
  readonly code: SourceIngestionErrorCode;

  constructor(code: SourceIngestionErrorCode, message: string) {
    super(message);
    this.name = "SourceIngestionError";
    this.code = code;
  }
}
