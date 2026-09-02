import type { ProcessingJob, ProcessingJobType } from "./job.js";

export interface JobHandlerContext {
  readonly job: ProcessingJob;
  readonly renewLease: () => Promise<boolean>;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;
export type JobHandlerRegistry = Partial<Readonly<Record<ProcessingJobType, JobHandler>>>;
export type PipelineJobOperations = Readonly<Record<ProcessingJobType, JobHandler>>;

export const createPipelineJobHandlers = (operations: PipelineJobOperations): JobHandlerRegistry =>
  Object.freeze({ ...operations });
