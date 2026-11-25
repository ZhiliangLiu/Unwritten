import { z } from "zod";
import { UuidSchema } from "./schemas/common.ts";
import { TurnRequestStatusSchema } from "./schemas/play.ts";
import { JobStatusSchema } from "./schemas/works.ts";

export const CoreEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("llm.config_changed") }),
  z.object({ type: z.literal("works.changed"), workId: UuidSchema }),
  z.object({ type: z.literal("job.updated"), workId: UuidSchema, jobId: UuidSchema, status: JobStatusSchema }),
  z.object({
    type: z.literal("turn_request.updated"),
    routeId: UuidSchema,
    requestId: UuidSchema,
    status: TurnRequestStatusSchema,
  }),
  z.object({ type: z.literal("turn.committed"), routeId: UuidSchema, turnId: UuidSchema }),
]);
export type CoreEvent = z.infer<typeof CoreEventSchema>;
