import {
  normalizationOutcomeRawItemId,
  normalizationOutcomeVersion,
  type NormalizationOutcome,
  type NormalizedItemId,
  type RawItem,
} from "@radar/core";

export interface RawItemNormalizer {
  readonly version: string;
  normalize(input: {
    readonly createdAt: string;
    readonly id: NormalizedItemId;
    readonly rawItem: RawItem;
  }): NormalizationOutcome;
}

export interface NormalizationSaveResult {
  readonly created: boolean;
  readonly outcome: NormalizationOutcome;
}

export interface NormalizationOutcomeRepository {
  count(): Promise<number>;
  save(outcome: NormalizationOutcome): Promise<NormalizationSaveResult>;
}

export interface ExecuteNormalizationInput {
  readonly createdAt: string;
  readonly id: NormalizedItemId;
  readonly normalizer: RawItemNormalizer;
  readonly rawItem: RawItem;
  readonly repository: NormalizationOutcomeRepository;
}

export class NormalizationUseCaseError extends Error {
  readonly code: "NORMALIZER_IDENTITY_MISMATCH" | "NORMALIZER_VERSION_MISMATCH";

  constructor(
    code: "NORMALIZER_IDENTITY_MISMATCH" | "NORMALIZER_VERSION_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "NormalizationUseCaseError";
    this.code = code;
  }
}

export const executeNormalization = async (
  input: ExecuteNormalizationInput,
): Promise<NormalizationSaveResult> => {
  const outcome = input.normalizer.normalize({
    createdAt: input.createdAt,
    id: input.id,
    rawItem: input.rawItem,
  });

  if (normalizationOutcomeRawItemId(outcome) !== input.rawItem.id) {
    throw new NormalizationUseCaseError(
      "NORMALIZER_IDENTITY_MISMATCH",
      "Normalizer returned an outcome for a different raw item",
    );
  }
  if (normalizationOutcomeVersion(outcome) !== input.normalizer.version) {
    throw new NormalizationUseCaseError(
      "NORMALIZER_VERSION_MISMATCH",
      "Normalizer outcome version does not match the declared normalizer version",
    );
  }

  return input.repository.save(outcome);
};
