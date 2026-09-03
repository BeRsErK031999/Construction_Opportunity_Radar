export type PipelineStage =
  "INGESTION" | "NORMALIZATION" | "DEDUPLICATION" | "CLASSIFICATION" | "ANALYSIS" | "SCORING";

export type OperationalEvent =
  | {
      readonly aiProcessingAllowed: boolean;
      readonly correlationId: string;
      readonly name: "raw_item_ingested";
      readonly outcome: "CREATED" | "EXISTING";
      readonly rawItemId: string;
      readonly sourceId: string;
    }
  | {
      readonly adapter: string;
      readonly candidates: number;
      readonly created: number;
      readonly existing: number;
      readonly fetches: number;
      readonly name: "source_ingestion_completed";
      readonly sourceId: string;
    }
  | {
      readonly adapter: string;
      readonly errorCode: string;
      readonly name: "source_ingestion_failed";
      readonly sourceId: string;
    }
  | {
      readonly analysisId: string;
      readonly correlationId: string;
      readonly created: boolean;
      readonly failureCode: string | null;
      readonly model: string;
      readonly name: "ai_analysis_completed";
      readonly provider: string;
      readonly providerCalled: boolean;
      readonly signalId: string;
      readonly status: "FAILED" | "SUCCEEDED";
    }
  | {
      readonly correlationId: string;
      readonly deliveryId: string | null;
      readonly failureCode: string | null;
      readonly kind: "DIGEST" | "OPPORTUNITY";
      readonly name: "delivery_completed";
      readonly opportunities: number;
      readonly outcome: "FAILED" | "PENDING" | "SENT" | "SKIPPED";
      readonly reused: boolean;
    }
  | {
      readonly created: number;
      readonly existing: number;
      readonly input: number;
      readonly name: "pipeline_stage_completed";
      readonly rejected: number;
      readonly runId: string;
      readonly stage: PipelineStage;
    }
  | {
      readonly name: "pipeline_run_completed";
      readonly runId: string;
    }
  | {
      readonly errorCode: string;
      readonly name: "pipeline_run_failed";
      readonly runId: string;
    };

export interface OperationalObserver {
  observe(event: OperationalEvent): void;
}

export const observeOperationalEvent = (
  observer: OperationalObserver | undefined,
  event: OperationalEvent,
): void => {
  try {
    observer?.observe(Object.freeze(event));
  } catch {
    // Telemetry must never change the business outcome.
  }
};
