import { auth } from "@/app/(auth)/auth";
import { z } from "zod";
import { getAgentSession } from "@/lib/db/agent-queries";
import { getRuntimeStatus, RuntimeApiError, runtimeConfiguration } from "@/lib/agent/runtime-client";
import { createTerminalTicket } from "@/lib/agent/terminal-ticket";

type Params = { params: Promise<{ id: string }> };
const inputSchema = z.object({ terminalId: z.uuid().optional() }).strict();

export async function POST(request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json({ error: { code: "RUNTIME_DISABLED" } }, { status: 503 });
  }
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== requestOrigin) {
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

  const session = await getAgentSession(id, user.user.id);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  // A provisioning sandbox can be debugged via terminal, but not a terminal for
  // an unknown/stale generation, deleted session, or stopped sandbox.
  if (!["PROVISIONING", "READY", "IDLE", "RUNNING", "WAITING_APPROVAL", "DEGRADED"].includes(session.state) ||
      session.generation < 1) {
    return Response.json({ error: { code: "SANDBOX_NOT_READY" } }, { status: 409 });
  }
  try {
    const remote = await getRuntimeStatus(id);
    if (!remote.running || remote.generation !== session.generation) {
      return Response.json({ error: { code: "SANDBOX_GENERATION_MISMATCH" } }, { status: 409 });
    }
    const terminalId = input.data.terminalId ?? crypto.randomUUID();
    const { token, expiresAt } = createTerminalTicket({
      sessionId: id, userId: user.user.id, terminalId, generation: remote.generation,
    });
    const { baseURL } = runtimeConfiguration();
    const ws = new URL("/ws/terminal/" + id, baseURL);
    ws.protocol = "wss:";
    ws.searchParams.set("session", terminalId);
    return Response.json({
      url: ws.toString(),
      protocol: "grokbot-ticket." + token,
      terminalId,
      expiresAt,
      generation: remote.generation,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch(error) {
    const code = error instanceof RuntimeApiError ? error.code : "TERMINAL_ISSUANCE_FAILED";
    return Response.json({ error: { code } }, { status: 503 });
  }
}
