import { z } from "zod";

export const HealthResponseSchema = z.strictObject({
  service: z.literal("api"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
