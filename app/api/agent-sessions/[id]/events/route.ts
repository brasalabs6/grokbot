import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { listAgentEvents } from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 }
    );
  }
  const { id } = await params;
  const url = new URL(request.url);
  const afterRaw = url.searchParams.get("after") ?? "0";
  if (!z.uuid().safeParse(id).success || !/^(0|[1-9]\d{0,9})$/.test(afterRaw)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR" } },
      { status: 400 }
    );
  }
  const events = await listAgentEvents(id, user.user.id, Number(afterRaw));
  return events
    ? Response.json({ cursor: events.at(-1)?.seq ?? Number(afterRaw), events })
    : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
}
