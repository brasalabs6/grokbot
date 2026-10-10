import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { RuntimeApiError, stopRuntime } from "@/lib/agent/runtime-client";
import {
  AgentConflict,
  claimStopOperation,
  confirmStoppedSandbox,
  markStopOutcomeUnknown,
} from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };
const inputSchema = z
  .object({
    checkpoint: z.boolean().default(true),
    expectedSessionVersion: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();

export async function POST(request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json(
      { error: { code: "RUNTIME_DISABLED" } },
      { status: 503 }
    );
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN" } },
      { status: 403 }
    );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR" } },
      { status: 400 }
    );
  }

  let claimed: Awaited<ReturnType<typeof claimStopOperation>>;
  try {
    claimed = await claimStopOperation({
      expectedVersion: parsed.data.expectedSessionVersion,
      operationId: parsed.data.operationId,
      ownerId: user.user.id,
      sessionId: id,
    });
  } catch (error) {
    if (error instanceof AgentConflict) {
      return Response.json({ error: { code: error.code } }, { status: 409 });
    }
    throw error;
  }
  if (!claimed) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  if (!claimed.claimed) {
    return Response.json(
      {
        idempotent: true,
        operationId: claimed.operation.id,
        operationState: claimed.operation.state,
        state: claimed.session.state,
      },
      { status: 202 }
    );
  }

  try {
    const stopped = await stopRuntime(
      id,
      parsed.data.operationId,
      parsed.data.checkpoint
    );
    if (stopped.running !== false) {
      throw new RuntimeApiError("RUNTIME_STOP_UNCONFIRMED", 502);
    }
    const updated = await confirmStoppedSandbox({
      generation: claimed.session.generation,
      operationId: parsed.data.operationId,
      ownerId: user.user.id,
      sessionId: id,
      snapshotId: stopped.snapshotId,
    });
    return Response.json({
      operationId: parsed.data.operationId,
      snapshotId: stopped.snapshotId ?? null,
      state: updated?.state,
      stateVersion: updated?.stateVersion,
    });
  } catch (error) {
    // Remote timeout may mean the stop succeeded. Do not dispatch another
    // destructive operation automatically or pretend the sandbox is running.
    await markStopOutcomeUnknown(id, parsed.data.operationId);
    return Response.json(
      {
        error: {
          code:
            error instanceof RuntimeApiError
              ? error.code
              : error instanceof AgentConflict
                ? error.code
                : "STOP_OUTCOME_UNKNOWN",
        },
        operationId: parsed.data.operationId,
        state: "STOPPING",
      },
      { status: 503 }
    );
  }
}
