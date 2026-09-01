export class DomainInvariantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainInvariantError";
    this.code = code;
  }
}

export function assertInvariant(
  condition: boolean,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DomainInvariantError(code, message);
  }
}
