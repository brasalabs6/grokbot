## UPDATE — October 12, 2026 (newer than the historical failure below)

Supabase `noagi` now contains an **ACTIVE_HEALTHY** dedicated `grokbot` project (`yfviherjflnuntzofsmd`, `us-west-2`). The earlier Free quota failure is historical, **no longer the provisioning blocker**. Both repository schema migrations have been applied and verified: 15 empty application tables; Row Level Security and restricted public access; Drizzle history recorded.

**Current production blockers:** Vercel still lacks `POSTGRES_URL`, `GROKBOT_SIGNUP_KEY`, `RUNTIME_TICKET_SECRET` and `CONTROL_PLANE_SERVICE_SECRET`, and these secrets must be configured without printing or committing them. The custom DB role `grokbot_runtime` is NOLOGIN pending a secure password-activation method. The operator can instead use the Supabase Connect dialog to obtain the project's **Transaction pooler** URI (port `6543`) for the `postgres` login, then add it privately to the Vercel project's environment variables as `POSTGRES_URL`. Copy the full host from Connect; never infer the `aws-[INDEX]` pooler index from `us-west-2`. If the original database password is unknown, reset it through Supabase Dashboard; do not send passwords in chat.

Vercel environment variable settings: `https://vercel.com/guicorinthias-gmailcoms-projects/grokbot/settings/environment-variables` (Preview and Production). Keep `FEATURE_AGENT_RUNTIME=0` until database/identity/runtime secrets are paired and `/api/readiness` succeeds. This project has not been merged or released; AgencyOS was not touched.

---

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

## Browser-to-Cloudflare staging acceptance workflow

A separate protected GitHub Actions workflow now runs an actual browser
against Next.js and PostgreSQL 17 (disposable CI database) connected to the
existing Cloudflare staging Worker. It uses environment-protected service
secrets and cleans up its sandbox in a `finally` block.

- Workflow: `.github/workflows/browser-staging-e2e.yml`
- Test: `tests/e2e/cloudflare-agent.test.ts`
- Run: https://github.com/brasalabs6/grokbot/actions/workflows/browser-staging-e2e.yml

The staging browser workflow is distinct from production acceptance. Only a
successful workflow run with verified real tool output closes its staging gate.

## Vercel Marketplace database option — verified 2026-10-11

- Vercel team: `nexus` (`guicorinthias-gmailcoms-projects`, `team_7I0mAEYzzzO86XIxP9EkNM0y`).
- Vercel application: `grokbot` (`prj_FhT9f4pd6Fh0KXEBznWUFQ5rCEoU`).
- Neon Marketplace integration **already installed** under configuration `icfg_AD4tOpq8jgzxxwtGw3gc6sXQ`. Do not install a duplicate integration.
- Vercel's live integration plan lookup confirmed `free_v3` **Free**, no payment method required; 1 GB per project, up to 100 CU-hours per project (provider terms subject to change). Other plans are paid and not authorized.
- Neon product metadata supports region `gru1` (Brazil). For the isolated GrokBot database, select name `grokbot`, `gru1`, `free_v3`, disable built-in Neon Auth (the application uses its own restricted NextAuth credentials), and connect to Vercel `grokbot` **preview** only until acceptance passes.
- Existing integration configuration shows no linked projects; Vercel project env keys contain **no** `POSTGRES_URL` / `DATABASE_URL` at inspection time. No persistent database has been provisioned or linked by this session.
- Vercel MCP currently exposes resource listing/configuration but **no Marketplace resource creation action**. The internal container lacks the Vercel CLI, `VERCEL_TOKEN`, and a local Vercel authenticated session. Do not invent credentials, or use an unrelated Vercel/AgencyOS database.
- **One-time provisioning step:** in [Vercel's Neon Marketplace](https://vercel.com/marketplace/neon) under the team above, create a new Free PostgreSQL store and link it to the project's preview deployment; alternatively, use an authenticated local Vercel CLI: `vercel integration add neon --name grokbot --plan free -e preview` after linking the correct project and inspecting `--help` for supported region/metadata arguments.
- Verify Vercel automatically injected pooled and direct/unchained connection variables, map the pooler URL to `POSTGRES_URL` securely if not already injected; run migrations against the isolated new Neon database and then do permanent end-to-end acceptance. Do not print connection strings to logs or commit them.
