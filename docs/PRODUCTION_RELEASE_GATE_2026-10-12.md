# GrokBot — Production release gate (2026-10-12)

## Verified as done

- **Dedicated database:** Supabase organization `noagi` / project `grokbot` (`yfviherjflnuntzofsmd`); PostgreSQL 17, `ACTIVE_HEALTHY`.
- **Migrations:** both repository SQL migrations applied (15 tables); Drizzle history registered; RLS enabled and public/anonymous Data API table access denied; Supabase security advisor found zero lint findings at verification.
- **Vercel database:** `POSTGRES_URL` is configured as a sensitive variable in Preview and Production. Preview function `/api/health/database` responded HTTP **200**, `{"connected":true}`, against the actual Supabase project at [verified deployment](https://grokbot-pe09411t2-guicorinthias-gmailcoms-projects.vercel.app/api/health/database). This route is intentionally unavailable in Production and does **not** assert full agent readiness.
- **Production Vercel auth:** `AUTH_SECRET` generated uniquely for Production (not shared with Preview); `GROKBOT_SIGNUP_KEY` and `GROKBOT_ALLOWED_EMAILS` configured for Production; `AUTH_TRUST_HOST=true`, `GROKBOT_ENABLE_GUEST=0`, `FEATURE_AGENT_RUNTIME=0`. Invitation code is stored encrypted and must not be published.
- **Cloudflare isolated Worker:** `grokbot-sandbox-runtime-production` was provisioned, has its own Durable Object/container image, an application-origin restriction, and received `GROKBOT_PROXY_API_KEY` via protected GitHub Actions (without disclosing it). **Not yet deployed/live.**

## Blocking external secret pairing (do not try to bypass)

The initial [production Worker bootstrap run](https://github.com/brasalabs6/grokbot/actions/runs/38296470338) reached the Cloudflare Docker image upload, then failed with **missing required secrets** `CONTROL_PLANE_SERVICE_SECRET` and `RUNTIME_TICKET_SECRET`. An attempt to populate these new privileged credentials programmatically was **blocked by the connector's safety checks**. Neither value has been configured automatically.

The operator must **generate two independent cryptographically random values of at least 32 bytes** (e.g., in a local password manager) and configure the *same* corresponding value at both:

1. **Cloudflare dashboard:** Workers & Pages → `grokbot-sandbox-runtime-production` → Settings → Variables and Secrets → add `CONTROL_PLANE_SERVICE_SECRET` and `RUNTIME_TICKET_SECRET` as **Secrets**, not plain text. Do not rotate staging Worker secrets.
2. **Vercel project:** [grokbot → Environment Variables](https://vercel.com/guicorinthias-gmailcoms-projects/grokbot/settings/environment-variables) → add those **same two values**, as **Secret/Sensitive** variables, target **Production only**. Do not send values via chat, tickets or Git.
3. Verify that the two Cloudflare production secret names appear (values never inspected). Re-run the [Bootstrap GrokBot production Worker](https://github.com/brasalabs6/grokbot/actions/workflows/bootstrap-sandbox-production.yml) workflow, via `workflow_dispatch`, from the reviewed feature branch. Its latest version **fails early** if either required Worker secret is missing, before doing another expensive container build.
4. Verify Cloudflare production `/health` responds 200 and that `APP_ORIGIN` matches the final Vercel application origin. The production Worker name and expected URL are `grokbot-sandbox-runtime-production.guibelongtovi-a22.workers.dev`. Check actual enabled subdomain after deployment; at last check the production Worker subdomain was disabled.
5. Add `CLOUDFLARE_RUNTIME_URL` (the verified HTTPS origin ending in `/`) to Vercel **Production**.
6. After all required environment variables are set and Cloudflare is healthy, set `FEATURE_AGENT_RUNTIME=1` for Production. Deploy **Production** from the tested Git SHA; a previously built Preview deployment is not equivalent because environment variables differ. Verify `GET /api/readiness` returns **200** with `{"ready":true}`; verify UI signup with the stored invitation code and an allowlisted operator email, login, create/start agent session, ACP websocket/tool approval, stop/checkpoint, resume, and persistence. Do not publicly claim functionality before all these pass.
7. Keep the PR draft until review/lint and full acceptance. Existing strict repository-wide lint is failing; prior full Cloudflare live browser tests were green on a disposable DB, but have **not** been repeated on this real production stack.

## Security / rollback

- Never expose DB passwords, Cloudflare proxy API key, invite code, auth secret, or ticket/control-plane secrets in files, GH logs, user chat, or unprotected HTTP responses.
- Keep `GROKBOT_ENABLE_GUEST=0` and Vercel Deployment Protection on for preview deployments. Set production access consciously after acceptance.
- The app and Worker use separate environments; do not reuse `staging` shared control/ticket secrets for Production.
- Failed rollout: immediately set Production `FEATURE_AGENT_RUNTIME=0`; use Vercel rollback to the prior working production deployment. Cloudflare runtime control-plane can remain isolated and inaccessible until fixed.
- Do not touch AgencyOS or the unrelated Supabase project.
