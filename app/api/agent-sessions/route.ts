import { ipAddress } from "@vercel/functions";
import { auth } from "@/app/(auth)/auth";
import { createSessionSchema } from "@/lib/agent/contracts";
import { createAgentSession, listAgentSessions } from "@/lib/db/agent-queries";
import { checkIpRateLimit } from "@/lib/ratelimit";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.type === "guest") {
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 }
    );
  }
  return Response.json({ items: await listAgentSessions(session.user.id) });
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN" } },
      { status: 403 }
    );
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json(
      { error: { code: "RUNTIME_DISABLED" } },
      { status: 503 }
    );
  }
  await checkIpRateLimit(ipAddress(request));
  const raw = await request.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", issues: parsed.error.issues } },
      { status: 400 }
    );
  }
  const created = await createAgentSession(session.user.id, parsed.data);
  // CREATED means only the database record exists; provisioning is a separate action.
  return Response.json({ session: created }, { status: 201 });
}
