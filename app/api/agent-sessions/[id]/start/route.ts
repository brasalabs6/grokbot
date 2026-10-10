import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { RuntimeApiError, startRuntime } from "@/lib/agent/runtime-client";
import {
  AgentConflict,
  claimStartOperation,
  recordProvisionedSandbox,
  recordStartOperationStatus,
  setAgentSessionState,
} from "@/lib/db/agent-queries";

const inputSchema = z
  .object({
    expectedSessionVersion: z.number().int().positive(),
    operationId: z.uuid(),
  })
  .strict();
type Params = { params: Promise<{ id: string }> };

/** Starts a sandbox but does not claim ACP READY until a persistent agent is healthy. */
export async function POST(request: Request, { params }: Params) {
  const logged = await auth();
  if (!logged?.user || logged.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json(
      { error: { code: "RUNTIME_DISABLED" } },
      { status: 503 }
    );
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN" } },
      { status: 403 }
    );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR" } },
      { status: 400 }
    );
  }

  let claimed;
  try {
    claimed = await claimStartOperation({
      expectedVersion: input.data.expectedSessionVersion,
      operationId: input.data.operationId,
      ownerId: logged.user.id,
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
    // Replay of an accepted operation: DO NOT dispatch a second start request.
    return Response.json(
      {
        idempotent: true,
        operationId: claimed.operation.id,
        operationState: claimed.operation.state,
        sessionId: id,
        state: claimed.session.state,
      },
      { status: 202 }
    );
  }

  try {
    const runtime = await startRuntime(id, input.data.operationId);
    if (
      !runtime.running ||
      !Number.isSafeInteger(runtime.generation) ||
      runtime.generation < 1
    ) {
      throw new RuntimeApiError("RUNTIME_START_UNCONFIRMED", 502);
    }
    const updated = await recordProvisionedSandbox({
      expectedVersion: claimed.session.stateVersion,
      generation: runtime.generation,
      ownerId: logged.user.id,
      sessionId: id,
    });
    await recordStartOperationStatus({
      operationId: input.data.operationId,
      sessionId: id,
      status: "EXECUTING",
    });
    return Response.json(
      {
        generation: runtime.generation,
        message:
          "Container start requested; waiting for persistent ACP readiness.",
        operationId: input.data.operationId,
        sessionId: id,
        state: updated?.state ?? "PROVISIONING",
      },
      { status: 202 }
    );
  } catch (error) {
    // Uncertain remote outcomes are never automatically retried.
    const uncertain =
      error instanceof RuntimeApiError &&
      ["RUNTIME_TIMEOUT", "RUNTIME_UNREACHABLE"].includes(error.code);
    await recordStartOperationStatus({
      operationId: input.data.operationId,
      sessionId: id,
      status: uncertain ? "OUTCOME_UNKNOWN" : "FAILED",
    }).catch(() => null);
    await setAgentSessionState({
      from: "PROVISIONING",
      ownerId: logged.user.id,
      sessionId: id,
      to: uncertain ? "RECOVERING" : "FAILED",
      version: claimed.session.stateVersion,
    }).catch(() => null);
    return Response.json(
      {
        error: {
          code: uncertain
            ? "RUNTIME_OUTCOME_UNKNOWN"
            : error instanceof RuntimeApiError
              ? error.code
              : "RUNTIME_START_FAILED",
        },
      },
      { status: uncertain ? 503 : 502 }
    );
  }
}
