import postgres from "postgres";

/**
 * Deployment readiness (not liveness). Do not confuse a successful Next.js
 * build or the public /ping proxy route with a usable agent application.
 *
 * This endpoint intentionally returns only a boolean status, never secrets,
 * database hostnames, tokens, project IDs, or internal exception messages.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const configured =
    process.env.FEATURE_AGENT_RUNTIME === "1" &&
    Boolean(process.env.POSTGRES_URL) &&
    Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) &&
    Boolean(process.env.GROKBOT_ALLOWED_EMAILS?.trim()) &&
    Boolean(
      process.env.GROKBOT_SIGNUP_KEY &&
        process.env.GROKBOT_SIGNUP_KEY.length >= 32
    ) &&
    Boolean(
      process.env.CONTROL_PLANE_SERVICE_SECRET &&
        process.env.CONTROL_PLANE_SERVICE_SECRET.length >= 32
    ) &&
    Boolean(
      process.env.RUNTIME_TICKET_SECRET &&
        process.env.RUNTIME_TICKET_SECRET.length >= 32
    );

  if (!configured) {
    return Response.json({ ready: false }, { headers, status: 503 });
  }

  let origin: URL;
  try {
    origin = new URL(process.env.CLOUDFLARE_RUNTIME_URL ?? "");
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    ) {
      return Response.json({ ready: false }, { headers, status: 503 });
    }
  } catch {
    return Response.json({ ready: false }, { headers, status: 503 });
  }

  const sql = postgres(process.env.POSTGRES_URL as string, {
    connect_timeout: 3,
    idle_timeout: 1,
    max: 1,
    prepare: false,
  });
  try {
    const [database, worker] = await Promise.all([
      sql`select 1 as ok`,
      fetch(new URL("/health", origin), {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }),
    ]);
    if (Number(database[0]?.ok) !== 1 || !worker.ok) {
      return Response.json({ ready: false }, { headers, status: 503 });
    }
    return Response.json({ ready: true }, { headers, status: 200 });
  } catch {
    return Response.json({ ready: false }, { headers, status: 503 });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}
