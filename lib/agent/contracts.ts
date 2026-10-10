import { z } from "zod";

/** Shared, versioned public contracts. No Cloudflare-specific types leak to the UI. */
export const sessionStates = [
  "CREATED",
  "PROVISIONING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "IDLE",
  "SUSPENDING",
  "SUSPENDED",
  "RESUMING",
  "STOPPING",
  "STOPPED",
  "RECOVERING",
  "DEGRADED",
  "FAILED",
  "DELETING",
  "DELETED",
] as const;
export const runStates = [
  "QUEUED_FOR_DISPATCH",
  "DISPATCHING",
  "RUNNING",
  "WAITING_APPROVAL",
  "CANCELLING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "OUTCOME_UNKNOWN",
] as const;
export const sandboxStates = [
  "ABSENT",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "STOPPED",
  "ERROR",
  "UNKNOWN",
] as const;
export const operationStates = [
  "PENDING",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "OUTCOME_UNKNOWN",
  "SUPERSEDED",
] as const;
export const permissionModes = ["ask", "auto"] as const;
export const sessionStateSchema = z.enum(sessionStates);
export const runStateSchema = z.enum(runStates);
export const sandboxStateSchema = z.enum(sandboxStates);
export const operationStateSchema = z.enum(operationStates);
export const uuidSchema = z.uuid();
export const createSessionSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    permissionMode: z.enum(permissionModes).default("ask"),
    runtimeProfile: z.literal("default").default("default"),
    title: z.string().trim().min(1).max(160).optional(),
    workspace: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("empty") }),
        z.object({
          kind: z.literal("git"),
          ref: z.string().max(160).optional(),
          url: z
            .url()
            .max(2048)
            .refine((value) => {
              const u = new URL(value);
              return (
                u.protocol === "https:" &&
                u.username === "" &&
                u.password === "" &&
                !["localhost", "127.0.0.1", "::1"].includes(u.hostname) &&
                !u.hostname.endsWith(".local")
              );
            }, "Only public HTTPS clone URLs are allowed"),
        }),
      ])
      .default({ kind: "empty" }),
  })
  .strict();
export const userMessagePartSchema = z
  .object({
    text: z.string().trim().min(1).max(40_000),
    type: z.literal("text"),
  })
  .strict();
export const submitPromptSchema = z
  .object({
    clientMessageId: uuidSchema,
    expectedSessionVersion: z.number().int().nonnegative(),
    parts: z.array(userMessagePartSchema).min(1).max(12),
  })
  .strict();
export const sessionEventSchema = z
  .object({
    eventId: uuidSchema,
    generation: z.number().int().nonnegative(),
    occurredAt: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()),
    runId: uuidSchema.nullable(),
    seq: z.number().int().positive(),
    sessionId: uuidSchema,
    type: z.string().min(1).max(100),
    v: z.literal(1),
  })
  .strict();
export type AgentSessionState = z.infer<typeof sessionStateSchema>;
export type AgentRunState = z.infer<typeof runStateSchema>;
export type AgentSessionEvent = z.infer<typeof sessionEventSchema>;
export type CreateAgentSessionInput = z.infer<typeof createSessionSchema>;
export type SubmitPromptInput = z.infer<typeof submitPromptSchema>;
