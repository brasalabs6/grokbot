import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Credential-safe proxy bridge. Grok uses the same OpenAI-compatible proxy
 * model configuration as the operator's local config.toml, but the real API
 * key is ONLY available in this Worker as a secret binding.
 *
 * Never pass GROKBOT_PROXY_API_KEY into the container image or start env.
 */
const PROXY_ORIGIN = "https://cf-ai-rate-proxy.brasaimainstream.workers.dev";
const PROXY_PATH = "/v1/chat/completions";
const ALLOWED_MODELS = new Set([
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/zai-org/glm-5.3",
  "@cf/zai-org/glm-5.2",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "glm-5.3-cyber",
  "glm-5.2-cyber",
  "glm-5.3-flash-cyber"
]);

export class WorkersAIGateway extends WorkerEntrypoint<{
  GROKBOT_PROXY_API_KEY: string;
}> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.origin !== PROXY_ORIGIN ||
      url.pathname !== PROXY_PATH ||
      url.search !== ""
    ) {
      return Response.json({ error: { code: "INFERENCE_ROUTE_FORBIDDEN" } }, { status: 403 });
    }

    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_000_000)) {
      return Response.json({ error: { code: "INFERENCE_BODY_TOO_LARGE" } }, { status: 413 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_000_000) {
      return Response.json({ error: { code: "INFERENCE_BODY_TOO_LARGE" } }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return Response.json({ error: { code: "INVALID_JSON" } }, { status: 400 });
    }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model) ||
      !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 200 ||
      (body.stream !== undefined && typeof body.stream !== "boolean")
    ) {
      return Response.json({ error: { code: "MODEL_OR_MESSAGES_FORBIDDEN" } }, { status: 403 });
    }

    const key = this.env.GROKBOT_PROXY_API_KEY;
    if (!key || key.length < 12) {
      console.error("Inference proxy credential not configured");
      return Response.json({ error: { code: "PROXY_NOT_CONFIGURED" } }, { status: 503 });
    }

    const headers = new Headers({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: body.stream === true ? "text/event-stream" : "application/json",
    });
    try {
      // Pass the OpenAI-compatible response through unchanged, including
      // SSE streaming, finish reasons, tool_calls and usage metadata.
      // No redirect may move the credential to another host.
      const upstream = await fetch(PROXY_ORIGIN + PROXY_PATH, {
        method: "POST",
        headers,
        body: raw,
        redirect: "manual",
        signal: AbortSignal.timeout(180_000),
      });
      const responseHeaders = new Headers({
        "Content-Type": upstream.headers.get("content-type") ??
          (body.stream ? "text/event-stream" : "application/json"),
        "Cache-Control": "no-store",
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return Response.json({ error: { code: "PROXY_REDIRECT_FORBIDDEN" } }, { status: 502 });
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (err) {
      console.error("Inference proxy request failed", err instanceof Error ? err.name : "unknown");
      return Response.json({ error: { code: "INFERENCE_PROXY_UNAVAILABLE" } }, { status: 502 });
    }
  }
}
