import "server-only";

/** Fail-closed server-to-server client for the Cloudflare Sandbox control plane. */
const ACTIONS = [
  "status",
  "start",
  "stop",
  "acp-smoke",
  "acp-events",
  "files",
] as const;
export type RuntimeAction = (typeof ACTIONS)[number];
export type RuntimeStatus = {
  running: boolean;
  generation: number;
  acpSessionId?: string | null;
  acpHealthyGeneration?: number;
  snapshotId?: string | null;
  lastRun?: {
    runId: string;
    generation: number;
    status: "SUCCEEDED" | "FAILED" | "CANCELLED";
    endedAt: number;
  } | null;
  activeRun?: { runId: string; generation: number; startedAt: number } | null;
};
export type RuntimeStartResult = {
  running: boolean;
  generation: number;
  idempotent: boolean;
};
export type RuntimeStopResult = {
  running: boolean;
  snapshotId?: string | null;
  idempotent?: boolean;
};

export class RuntimeApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
    this.name = "RuntimeApiError";
  }
}

export function runtimeConfiguration(): { baseURL: string; secret: string } {
  const raw = process.env.CLOUDFLARE_RUNTIME_URL;
  const secret = process.env.CONTROL_PLANE_SERVICE_SECRET;
  if (!raw || !secret || secret.length < 32) {
    throw new RuntimeApiError("RUNTIME_NOT_CONFIGURED", 503);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RuntimeApiError("INVALID_RUNTIME_URL", 500);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new RuntimeApiError("INVALID_RUNTIME_URL", 500);
  }
  return { baseURL: parsed.origin, secret };
}

export async function callRuntime<T>(
  sessionId: string,
  action: RuntimeAction,
  body?: Record<string, unknown>,
  requestFetch: typeof fetch = fetch
): Promise<T> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionId
    )
  ) {
    throw new RuntimeApiError("INVALID_SESSION_ID", 400);
  }
  if (!ACTIONS.includes(action)) {
    throw new RuntimeApiError("INVALID_ACTION", 400);
  }
  const { baseURL, secret } = runtimeConfiguration();
  const method =
    action === "status" || action === "acp-events" ? "GET" : "POST";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const after = body?.after;
    if (
      action === "acp-events" &&
      (!Number.isSafeInteger(after) || Number(after) < 0)
    ) {
      throw new RuntimeApiError("INVALID_CURSOR", 400);
    }
    const path =
      baseURL +
      "/internal/" +
      sessionId +
      "/" +
      action +
      (action === "acp-events" ? "?after=" + String(after) : "");
    const response = await requestFetch(path, {
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + secret,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      method,
      signal: controller.signal,
    });
    // Never include remote error body in thrown errors: it might contain secrets.
    if (!response.ok) {
      throw new RuntimeApiError("RUNTIME_HTTP_" + response.status, 502);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RuntimeApiError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new RuntimeApiError("RUNTIME_TIMEOUT", 504);
    }
    throw new RuntimeApiError("RUNTIME_UNREACHABLE", 503);
  } finally {
    clearTimeout(timer);
  }
}

export const getRuntimeStatus = (sessionId: string) =>
  callRuntime<RuntimeStatus>(sessionId, "status");
export const startRuntime = (sessionId: string, operationId: string) =>
  callRuntime<RuntimeStartResult>(sessionId, "start", { operationId });
export const stopRuntime = (
  sessionId: string,
  operationId: string,
  checkpoint: boolean
) =>
  callRuntime<RuntimeStopResult>(sessionId, "stop", {
    checkpoint,
    operationId,
  });
export const probeAcp = (sessionId: string) =>
  callRuntime<{ ok: boolean; error?: string; updateTypes?: string[] }>(
    sessionId,
    "acp-smoke",
    { confirm: true }
  );

export const getRuntimeAcpEvents = (sessionId: string, after: number) =>
  callRuntime<{
    events: { seq: number; at: string; message: Record<string, unknown> }[];
    cursor: number;
  }>(sessionId, "acp-events", { after });

export type SandboxWorkspaceItem = {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
};
export type SandboxWorkspaceResponse = {
  ok: boolean;
  kind?: "file" | "directory";
  path?: string;
  content?: string;
  items?: SandboxWorkspaceItem[];
  truncated?: boolean;
  total?: number;
  size?: number;
  error?: { code: string };
};
export const inspectSandboxWorkspace = (
  sessionId: string,
  operation: "list" | "read",
  path: string
) =>
  callRuntime<SandboxWorkspaceResponse>(sessionId, "files", {
    op: operation,
    path,
  });
