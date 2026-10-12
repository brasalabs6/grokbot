import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { submitPromptSchema } from "@/lib/agent/contracts";
import { hashPrompt, signRunPermit } from "@/lib/agent/run-permit";
import { AgentConflict, acceptAgentRun } from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };

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
  if (
    !process.env.RUNTIME_TICKET_SECRET ||
    process.env.RUNTIME_TICKET_SECRET.length < 32
  ) {
    return Response.json(
      { error: { code: "RUN_DISPATCH_NOT_CONFIGURED" } },
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
  const parsed = submitPromptSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_RUN_INPUT" } },
      { status: 400 }
    );
  }
  const requestHash = hashPrompt(parsed.data.parts);
  try {
    const accepted = await acceptAgentRun({
      idempotencyKey: parsed.data.clientMessageId,
      input: parsed.data,
      ownerId: logged.user.id,
      requestHash,
      sessionId: id,
    });
    if (!accepted) {
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }
    const permit = signRunPermit({
      generation: accepted.run.generation,
      promptHash: requestHash,
      runId: accepted.run.id,
      sessionId: id,
      userId: logged.user.id,
    });
    return Response.json(
      {
        duplicate: accepted.duplicate,
        expiresAt: permit.expiresAt,
        generation: accepted.run.generation,
        permit: permit.permit,
        runId: accepted.run.id,
      },
      { headers: { "Cache-Control": "no-store" }, status: 202 }
    );
  } catch (error) {
    if (error instanceof AgentConflict) {
      return Response.json({ error: { code: error.code } }, { status: 409 });
    }
    throw error;
  }
}
