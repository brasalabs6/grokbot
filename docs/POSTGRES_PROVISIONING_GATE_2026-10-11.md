# GrokBot — dedicated PostgreSQL provisioning gate (2026-10-11)

## Current real state

- Connected Supabase organization: `noagi` (`dzzlluipmossecsmzzno`), Free plan.
- Existing accessible project: `agency-os` in `sa-east-1`. **Do not reuse, pause, delete, migrate, or modify it to host GrokBot.**
- Supabase `get_cost(project)`: USD **0/month** on the Free plan.
- An authorized `create_project(name=grokbot, region=sa-east-1)` was attempted and **rejected by Supabase** because an organization admin already has two active Free projects across organizations. There is no new GrokBot Supabase project, database, or connection string.
- Vercel preview currently has `FEATURE_AGENT_RUNTIME=0` and lacks a dedicated `POSTGRES_URL` and paired runtime signing credentials. Do not describe its `READY` deployment as a functional app.

## Unblocking options

1. **Preferred for Supabase Free:** owner identifies a different unused Supabase Free project and pauses it *after verifying it has no active dependencies*; then retry creating dedicated `grokbot` in `noagi`. Never choose or alter another project without explicit approval.
2. Create a separate paid Supabase organization only after getting a concrete price, cost confirmation, and owner approval. Do not automatically upgrade `noagi`.
3. Use an independent PostgreSQL provider such as Neon if the owner connects that service. Keep GrokBot on its own database. Do not reuse AgencyOS's project/database.

## Provision and deploy sequence after unblocking

1. Create independent PostgreSQL project, preferably in `sa-east-1`, with strong database credentials and backups appropriate to environment.
2. Obtain **two** secure connection strings from the provider:
   - Vercel serverless transaction-pooler connection string (`POSTGRES_URL`, usually pooler port `6543`; for `postgres` library with a transaction pooler, ensure no prepared-statement reliance and a small pool).
   - Temporary session/direct URL for one-off Drizzle migrations. Direct Supabase connection can require IPv6; use session pooler on IPv4 CI hosts.
3. Run `pnpm db:migrate` **only** against the new project and verify tables `User`, `AgentSession`, `AgentSandbox`, `AgentRun`, `AgentEvent`, `AgentOperation` etc.
4. Restrict all database access to backend. Review Supabase Data API exposure: existing Drizzle tables must not be publicly writable/readable from `anon` or `authenticated` keys. Use a private schema or explicit REVOKE/enable RLS and test access as needed.
5. Configure Vercel **preview** with: encrypted `POSTGRES_URL`, `AUTH_SECRET`, `GROKBOT_ALLOWED_EMAILS`, `GROKBOT_SIGNUP_KEY`, `CLOUDFLARE_RUNTIME_URL`, `CONTROL_PLANE_SERVICE_SECRET`, `RUNTIME_TICKET_SECRET`; leave `FEATURE_AGENT_RUNTIME=0` until all secrets match and migrations passed.
6. Preserve the existing protected staging Cloudflare Worker secrets. Pair the *same* ticket/control-plane secret values with Vercel. Never read or expose tokens in commits, CI logs, chat responses, or the browser.
7. Create the first authorized internal user with the private invitation code; verify only intended email can sign in. Then enable `FEATURE_AGENT_RUNTIME=1` in **preview** and deploy.
8. Run browser E2E with actual database + Cloudflare: session create, sandbox start, ACP handshake, prompt with tool creation, event reconciliation, terminal, files, stop, snapshot, resume and ownership/CSRF boundaries.
9. Complete repository-wide lint, multi-user isolation, snapshot/recovery failure scenarios and independent R2 backup/restore acceptance before production. Do not merge to `main` beforehand.

## What is verified (before dedicated DB)

- Isolated CI PostgreSQL 17 migrations + seven Playwright browser tests passed: [38071688894](https://github.com/brasalabs6/grokbot/actions/runs/38071688894).
- Cloudflare ACP, proxy inference, PTY, actual filesystem tool and snapshot resume passed: [38071547706](https://github.com/brasalabs6/grokbot/actions/runs/38071547706).
- Current branch still needs post-change checks and permanent deploy acceptance.

The system is **partially implemented, not 100% ready**. A temporary preview URL does not waive the gate.
