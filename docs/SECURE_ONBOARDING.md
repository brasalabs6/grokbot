# GrokBot V1 — secure internal onboarding and release gates

## Security defaults

GrokBot is an internal coding-agent platform, not a public signup service.
Production and preview deployments must be treated as untrusted even behind
an identity-protected preview URL.

- `GROKBOT_ALLOWED_EMAILS`: comma-separated list of authorized email addresses.
  If absent, all regular credential logins and registrations fail closed.
- `GROKBOT_SIGNUP_KEY`: random private invitation code of at least 32 characters.
  The signup form requires this code in addition to an allowlisted email.
  Do not publish the value in Git, web pages, logs or a client-side variable.
  Rotate it after provisioning internal accounts.
- `GROKBOT_ENABLE_GUEST`: defaults off. Set to `1` only for an isolated legacy-chat
  test environment. Public guest accounts must not be able to create sandboxes.
- `AUTH_SECRET`: unique encrypted secret, not a CI key.
- `POSTGRES_URL`: dedicated PostgreSQL URI; never the AgencyOS database.
- `FEATURE_AGENT_RUNTIME`: defaults to `0`; enable only once the database
  migrations, paired Cloudflare control-plane secrets and end-to-end checks pass.
- `CLOUDFLARE_RUNTIME_URL`: HTTPS origin, plus paired
  `CONTROL_PLANE_SERVICE_SECRET` and `RUNTIME_TICKET_SECRET`.
  Never expose any service credentials to the sandbox filesystem.

## Deployment sequence

1. Confirm the intended database organization and cost before provisioning.
   Never reuse an unrelated application's database.
2. Add credentials as Vercel **preview** environment secrets; do not log their
   decrypted values or add them to source files.
3. Explicitly apply `pnpm db:migrate` once against the dedicated database.
   `pnpm build` no longer executes migrations.
4. Confirm a registered, authorized internal account can sign in.
5. Run CI browser tests with a disposable PostgreSQL service and the Cloudflare
   staging E2E with a disposable sandbox.
6. Configure the matching control-plane signing secrets, enable the runtime
   flag for staging and re-deploy the preview.
7. Verify real session create, start, ACP, prompt, tool events, terminal,
   reconnection, file operations, cancellation, lifecycle and restore.
8. Complete threat-model review and only then consider production release.

## Evidence as of October 10, 2026

- Cloudflare container ACP, Qwen proxy inference and real filesystem tool
  execution passed in [staging E2E 38017545630](https://github.com/brasalabs6/grokbot/actions/runs/38017545630).
- Vercel technical preview previously returned HTTP 500 for `/login`
  because the guest-auth redirect required a missing DB. The new
  authenticated-entrypoint implementation returned HTTP 200 from `/login`
  on a protected preview.
- PostgreSQL 17 disposable CI setup and Drizzle migrations passed in
  [Playwright workflow 38070503190](https://github.com/brasalabs6/grokbot/actions/runs/38070503190).
  Browser checks were still in progress when this document was written.
- Dedicated persistent PostgreSQL, browser-to-Cloudflare full integration,
  R2 recovery and release review have **not** been accepted yet.

Do not advertise a Vercel READY build as a fully functional GrokBot V1.
