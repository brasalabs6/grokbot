import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getRuntimeStatus, RuntimeApiError } from "@/lib/agent/runtime-client";
import {
  AgentConflict,
  confirmStoppedSandbox,
  getAgentSession,
} from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };
const inputSchema = z.object({ operationId: z.uuid() }).strict();

/** Read the DO's actual state; never retry a potentially completed STOP. */
export async function POST(request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json({ error: { code: "RUNTIME_DISABLED" } }, { status: 503 });
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return Response.json({ error: { code: "INVALID_ORIGIN" } }, { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
  }
  const owned = await getAgentSession(id, user.user.id);
  if (!owned) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  try {
    const remote = await getRuntimeStatus(id);
    if (remote.generation !== owned.generation) {
      return Response.json(
        { error: { code: "SANDBOX_GENERATION_MISMATCH" } },
        { status: 409 }
      );
    }
    if (remote.running) {
      return Response.json(
        { error: { code: "STOP_NOT_CONFIRMED" } },
        { status: 409 }
      );
    }
    const updated = await confirmStoppedSandbox({
      generation: owned.generation,
      operationId: input.data.operationId,
      ownerId: user.user.id,
      sessionId: id,
      snapshotId: remote.snapshotId,
    });
    return Response.json({
      state: updated?.state,
      stateVersion: updated?.stateVersion,
      snapshotId: remote.snapshotId ?? null,
      operationId: input.data.operationId,
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          code:
            error instanceof AgentConflict
              ? error.code
              : error instanceof RuntimeApiError
                ? error.code
                : "STOP_RECONCILIATION_FAILED",
        },
      },
      { status: 503 }
    );
  }
}
