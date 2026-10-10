import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  inspectSandboxWorkspace,
  RuntimeApiError,
} from "@/lib/agent/runtime-client";
import { getAgentSession } from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const logged = await auth();
  if (!logged?.user || logged.user.type === "guest") {
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 }
    );
  }
  if (process.env.FEATURE_AGENT_RUNTIME !== "1") {
    return Response.json(
      { error: { code: "RUNTIME_DISABLED" } },
      { status: 503 }
    );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  const owned = await getAgentSession(id, logged.user.id);
  if (!owned) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  if (
    ![
      "PROVISIONING",
      "READY",
      "IDLE",
      "RUNNING",
      "WAITING_APPROVAL",
      "DEGRADED",
    ].includes(owned.state)
  ) {
    return Response.json(
      { error: { code: "SANDBOX_NOT_READY" } },
      { status: 409 }
    );
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "list";
  const path = url.searchParams.get("path") ?? ".";
  if ((mode !== "list" && mode !== "read") || path.length > 1024) {
    return Response.json(
      { error: { code: "INVALID_WORKSPACE_INPUT" } },
      { status: 400 }
    );
  }
  try {
    const output = await inspectSandboxWorkspace(id, mode, path);
    return Response.json(output, {
      headers: { "Cache-Control": "no-store" },
      status: output.ok ? 200 : 400,
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          code:
            error instanceof RuntimeApiError
              ? error.code
              : "WORKSPACE_UNAVAILABLE",
        },
      },
      { status: 503 }
    );
  }
}
