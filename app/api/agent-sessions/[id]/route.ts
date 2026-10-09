import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  AgentConflict,
  getAgentSession,
  renameAgentSession,
} from "@/lib/db/agent-queries";

const updateSchema = z
  .object({
    expectedSessionVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
  })
  .strict();
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 }
    );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const session = await getAgentSession(id, user.user.id);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  return Response.json({ session });
}
export async function PATCH(request: Request, { params }: Params) {
  const user = await auth();
  if (!user?.user || user.user.type === "guest") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR" } },
      { status: 400 }
    );
  }
  try {
    const updated = await renameAgentSession(
      id,
      user.user.id,
      parsed.data.title,
      parsed.data.expectedSessionVersion
    );
    return updated
      ? Response.json({ session: updated })
      : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  } catch (error) {
    if (error instanceof AgentConflict) {
      return Response.json({ error: { code: error.code } }, { status: 409 });
    }
    throw error;
  }
}
