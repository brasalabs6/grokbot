import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Grok's OpenAI-compatible requests enter through HTTPS interception.
 * The container uses a public, deliberately fake API key; real account access
 * is exclusively through the Workers AI binding in this trusted Worker.
 */
export class WorkersAIGateway extends WorkerEntrypoint<{
  AI: Ai;
  CF_ACCOUNT_ID: string;
}> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = "/client/v4/accounts/" +
      this.env.CF_ACCOUNT_ID + "/ai/v1/chat/completions";

    if (request.method !== "POST" ||
        url.hostname !== "api.cloudflare.com" ||
        url.pathname !== route ||
        url.search !== "") {
      return Response.json({error:{code:"INFERENCE_ROUTE_FORBIDDEN"}}, {status:403});
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > 1_000_000) {
      return Response.json({error:{code:"INFERENCE_BODY_TOO_LARGE"}},{status:413});
    }
    const raw = await request.text();
    if (raw.length > 1_000_000) {
      return Response.json({error:{code:"INFERENCE_BODY_TOO_LARGE"}},{status:413});
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({error:{code:"INVALID_JSON"}},{status:400});
    }
    if (!body || Array.isArray(body) || typeof body !== "object" ||
        body.model !== "@cf/openai/gpt-oss-120b" ||
        !Array.isArray(body.messages) || body.messages.length > 200) {
      return Response.json({error:{code:"MODEL_OR_MESSAGES_FORBIDDEN"}},{status:403});
    }

    try {
      const result = await this.env.AI.run("@cf/openai/gpt-oss-120b", body as never);
      if (result instanceof ReadableStream) {
        return new Response(result as ReadableStream<Uint8Array>, {
          headers: {"Content-Type":"text/event-stream","Cache-Control":"no-store"}
        });
      }
      return Response.json(result);
    } catch(error) {
      console.error("Workers AI unavailable", error instanceof Error ? error.name : "unknown");
      return Response.json({error:{code:"WORKERS_AI_UNAVAILABLE"}},{status:502});
    }
  }
}
