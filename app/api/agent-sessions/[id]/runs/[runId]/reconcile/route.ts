import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getRuntimeStatus, RuntimeApiError } from "@/lib/agent/runtime-client";
import {
  AgentConflict,
  getAgentSession,
  reconcileCompletedAgentRun,
} from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string; runId: string }> };
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
  const { id, runId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(runId).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const owned = await getAgentSession(id, user.user.id);
  if (!owned) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  try {
    const remote = await getRuntimeStatus(id);
    if (
      remote.generation !== owned.generation ||
      !remote.lastRun ||
      remote.lastRun.runId !== runId ||
      remote.lastRun.generation !== owned.generation
    ) {
      return Response.json(
        { error: { code: "RUN_OUTCOME_NOT_CONFIRMED" } },
        { status: 409 }
      );
    }
    const outcome = await reconcileCompletedAgentRun({
      endedAt: remote.lastRun.endedAt,
      generation: remote.generation,
      ownerId: user.user.id,
      runId,
      sessionId: id,
      status: remote.lastRun.status,
    });
    if (!outcome) {
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }
    return Response.json({
      idempotent: outcome.idempotent,
      runId,
      sessionState: outcome.session.state,
      sessionVersion: outcome.session.stateVersion,
      state: outcome.run.state,
    });
  } catch (error) {
    if (error instanceof AgentConflict) {
      return Response.json({ error: { code: error.code } }, { status: 409 });
    }
    return Response.json(
      {
        error: {
          code:
            error instanceof RuntimeApiError
              ? error.code
              : "RUN_RECONCILE_UNAVAILABLE",
        },
      },
      { status: 503 }
    );
  }
}
