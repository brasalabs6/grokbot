import postgres from "postgres";

/**
 * Preview-only database connectivity probe. It intentionally exposes no
 * connection strings, table names, internal errors, or identifying metadata.
 * Vercel Deployment Protection must remain enabled for previews.
 * Never treat this probe as full application readiness.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };

  if (process.env.VERCEL_ENV !== "preview") {
    return new Response(null, { status: 404, headers });
  }

  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    return Response.json({ connected: false }, { headers, status: 503 });
  }

  let sql: ReturnType<typeof postgres> | undefined;
  try {
    sql = postgres(databaseUrl, {
      connect_timeout: 4,
      idle_timeout: 1,
      max: 1,
      prepare: false,
    });
    const [result] = await sql`
      select
        to_regclass('public."User"') is not null as users_ready,
        to_regclass('public."AgentSession"') is not null as sessions_ready,
        to_regclass('public."AgentRun"') is not null as runs_ready,
        (
          select count(*)
          from drizzle.__drizzle_migrations
        ) >= 2 as migrations_ready
    `;
    const connected = Boolean(
      result?.users_ready &&
        result?.sessions_ready &&
        result?.runs_ready &&
        result?.migrations_ready
    );
    return Response.json(
      { connected },
      { headers, status: connected ? 200 : 503 }
    );
  } catch {
    return Response.json({ connected: false }, { headers, status: 503 });
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => undefined);
  }
}
