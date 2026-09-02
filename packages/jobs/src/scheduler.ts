import { randomUUID } from "node:crypto";

import type { JobPayload, ProcessingJobType } from "./job.js";
import type { ProcessingJobRepository } from "./repository.js";

export interface FixedIntervalJobSchedule {
  readonly anchorAt: string;
  readonly concurrencyKey: string;
  readonly entityKey: string;
  readonly everyMs: number;
  readonly maxAttempts?: number;
  readonly payload: JobPayload;
  readonly payloadVersion: string;
  readonly scheduleKey: string;
  readonly type: ProcessingJobType;
}

export interface JobIdentityFactory {
  readonly correlationId: () => string;
  readonly jobId: () => string;
}

export interface ScheduleJobsResult {
  readonly created: number;
  readonly existing: number;
  readonly notStarted: number;
  readonly overlapBlocked: number;
}

const defaultIdentities: JobIdentityFactory = Object.freeze({
  correlationId: randomUUID,
  jobId: randomUUID,
});

const timestamp = (value: string, field: string): number => {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) {
    throw new RangeError(`${field} must be an ISO date-time`);
  }
  return result;
};

export const scheduleBucketStart = (
  schedule: FixedIntervalJobSchedule,
  now: string,
): string | null => {
  if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs <= 0) {
    throw new RangeError("schedule everyMs must be a positive safe integer");
  }
  const anchorAt = timestamp(schedule.anchorAt, "schedule anchorAt");
  const currentAt = timestamp(now, "scheduler now");
  if (currentAt < anchorAt) {
    return null;
  }
  const bucket = Math.floor((currentAt - anchorAt) / schedule.everyMs);
  return new Date(anchorAt + bucket * schedule.everyMs).toISOString();
};

export const scheduleDueJobs = async (input: {
  readonly defaultMaxAttempts?: number;
  readonly identities?: JobIdentityFactory;
  readonly now: string;
  readonly repository: ProcessingJobRepository;
  readonly schedules: readonly FixedIntervalJobSchedule[];
}): Promise<ScheduleJobsResult> => {
  const identities = input.identities ?? defaultIdentities;
  let created = 0;
  let existing = 0;
  let notStarted = 0;
  let overlapBlocked = 0;

  for (const schedule of input.schedules) {
    const bucketStart = scheduleBucketStart(schedule, input.now);
    if (bucketStart === null) {
      notStarted += 1;
      continue;
    }
    const result = await input.repository.enqueue({
      concurrencyKey: schedule.concurrencyKey,
      correlationId: identities.correlationId(),
      createdAt: input.now,
      entityKey: schedule.entityKey,
      id: identities.jobId(),
      idempotencyKey: `${schedule.scheduleKey}:${bucketStart}`,
      maxAttempts: schedule.maxAttempts ?? input.defaultMaxAttempts ?? 5,
      payload: schedule.payload,
      payloadVersion: schedule.payloadVersion,
      scheduledAt: bucketStart,
      type: schedule.type,
    });
    if (result.outcome === "CREATED") {
      created += 1;
    } else if (result.outcome === "EXISTING") {
      existing += 1;
    } else {
      overlapBlocked += 1;
    }
  }

  return Object.freeze({ created, existing, notStarted, overlapBlocked });
};
