# GrokBot V1 — Implementation status

Last updated: 2026-10-09. **Work in progress; no production release.**

## Source of truth

- Spec: `docs/FEATURE_SPEC_V1.md` on main.
- Implementation PR: #1, branch `feat/grokbot-p00-acp-cloudflare-spike`.
- Keep main stable. This draft PR has NOT passed the complete V1 acceptance gates.

## Confirmed evidence

1. Local Grok Build 1.0.50 ACP `initialize`, `session/new` and file/tool smoke passed on a scratch workspace.
2. Workers AI `@cf/openai/gpt-oss-120b` returned a genuine structured tool call via the connected Cloudflare account.
3. Cloudflare Worker `grokbot-sandbox-runtime-staging` was deployed, with HMAC secrets stored outside Git. Its health endpoint returned HTTP 200.
4. A real Cloudflare container was started via the authenticated control plane and reported generation 1; a later generation 2 container reported successful start/status/exec, and `grok --version` executed successfully inside it.
5. Local GitHub Actions Docker smoke subsequently confirmed that the built image listens as a Grok WebSocket ACP server and successfully responds to protocol initialization. This is not equivalent to a real inference/tool run on Cloudflare.
6. GitHub Actions runtime TypeScript and session contract checks have passed at prior checkpoints. The complete Next.js application and Playwright suite are not green.
7. The first staging ACP WebSocket smoke failed (HTTP 503 / connection failure); upstream request, Durable Object fetch and WebSocket subprotocol fixes have since been committed, but not independently verified in the live staging Worker.

## Implemented code awaiting full integration validation

- Authenticated session create/list/detail/rename, lifecycle and generation-fenced start; Drizzle schema and additive SQL migration.
- Cloudflare Container API 1.0 Durable Object, snapshot/restore hooks, non-root Grok daemon image, guarded HTTPS inference binding, no real Cloudflare secret in the container.
- WebSocket ACP bridge and persistent event replay/cursor; session/new/load; permissions UI, streaming text/tools and cancellation.
- Transactional run admission, HMAC-signed exact-prompt one-time dispatch permits, generation checks, duplicate prevention and durable run completion records with DB reconciliation.
- xterm.js PTY/tmux terminal with generation-bound tickets and reconnection.
- Read-only authenticated workspace file browser, path confinement, textual file preview, with traversal/symlink CI tests.
- Docker startup wrapper that suppresses Grok startup logs to prevent exposing its ACP server token.
- CI for Docker build, WebSocket ACP initialization, workspace isolation, TypeScript and contracts; manual GitHub Actions staging deployment workflow.

## Verified staging deployment through GitHub Actions (2026-10-09)

- The operator configured the protected GitHub `staging` environment with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- GitHub Actions run [37995647338](https://github.com/brasalabs6/grokbot/actions/runs/37995647338) completed successfully for commit `6592e51d747925b0b9baec76e962218f26a8461b`.
- The runner verified credentials, installed dependencies, passed the runtime typecheck, built/uploaded the container image, deployed Worker `grokbot-sandbox-runtime-staging` and received an HTTP 200 from `/health`.
- The Cloudflare API independently confirmed the Worker modification at `2026-10-09T21:50:14Z`. Deployed Worker version: `65840eba-20d8-49a5-8683-6ce8f96dd09f`.
- All deployment occurred through GitHub Actions without Predator. **This confirms health/deploy only; it is not an ACP tool E2E pass.**
- A separate opt-in `.github/workflows/staging-e2e.yml` and `services/sandbox-runtime/tools/staging-e2e.mjs` were added. They create a disposable sandbox, verify PTY/tmux reconnect, ACP `initialize` and `session/new`, Workers AI tool execution and actual workspace file creation, and clean up after the test.
- Before triggering this live smoke, configure the matching `CONTROL_PLANE_SERVICE_SECRET` and `RUNTIME_TICKET_SECRET` as additional protected secrets in the GitHub staging environment. Their existing values were previously stored only in the operator's Linux `~/.config/grokbot/staging-runtime-secrets.env`. Never paste either secret into chat or Git.

## Outstanding V1 P0 gates

1. **Cloudflare live ACP:** deploy the latest branch to staging, check `/internal/:id/acp-port-health`, connect signed WebSocket, run `initialize` + `session/new` + a real prompt with filesystem tool calls using Workers AI and verify output.
2. **Frontend provision:** create Vercel project, configure private runtime URL and secrets; set up PostgreSQL migrations in a test environment. Do not enable FEATURE_AGENT_RUNTIME for production without verified integration.
3. **Session recovery:** test cancel, browser disconnect, competing tabs, DO restart, stale generations and unknown outcomes. Ensure no duplicate prompt execution.
4. **Files and terminal:** validate real PTY resize/input/reconnect and new file listing API on a deployed Cloudflare container.
5. **Workspace/Git lifecycle:** finish Git operations, robust backup/restore verification (R2), idle policy/reconciliation and recovery paths.
6. **Quality/security:** complete TypeScript and Biome cleanup, full build, E2E Playwright, migration dry-run against a disposable DB, threat model and abuse/rate limits.
7. **Production:** only after all gates pass, promote release with controlled secrets and monitoring.

## Deployment constraints and operator needs

- Cloudflare Wrangler was authorized on the user's Linux; the Predator connector session later terminated. GitHub Actions deployment now works independently.
- Staging Worker was updated successfully to commit `6592e51`. Later test-workflow-only commits are not redeployed until the next authorized staging run.
- To avoid requiring the user's Linux for each deployment, `.github/workflows/deploy-sandbox-staging.yml` was added. It runs manually on the feature branch in the GitHub `staging` environment. Configure the environment secret `CLOUDFLARE_API_TOKEN` (least-privilege Worker/Containers deployment token) and variable `CLOUDFLARE_ACCOUNT_ID` directly in GitHub settings. Never send credentials in chat or commit them.
- The existing Cloudflare service and terminal signing secrets remain outside Git and are not echoed by any command.
- The legacy chatbot had 31 TypeScript errors before this phase, concentrated in old SDK/JSON typing; a focused correction to `lib/utils.ts` was started but the full build gate is open.
- No Vercel GrokBot project was found in the connected account during last inspection.
- There has been no merge into main and no application production deployment.

**Current status: successful GitHub Actions Cloudflare staging deploy and local Docker ACP acceptance; live Grok-on-Workers-AI and terminal/recovery E2E still pending.**

## Proxy inference change — 2026-10-09

The operator explicitly selected the inference proxy configured in the
local Grok Build `~/.grok/config.toml`, instead of the earlier direct
Cloudflare Workers AI `AI.run` route.

- Architecture decision: [ADR-002](ADR-002-PROXY-INFERENCE.md).
- Endpoint: `https://cf-ai-rate-proxy.brasaimainstream.workers.dev/v1`.
- Default: `cf-qwen3.8-27b` (`@cf/qwen/qwen3.8-27b`).
- Auxiliary: `cf-glm-5.3-flash` (`@cf/zai-org/glm-5.3-flash`).
- Eight model profiles mirrored **without credentials** in
  `services/sandbox-runtime/config/grok-models.toml`.
- Inference binding now forwards OpenAI-compatible chat/tool-call/SSE responses
  through trusted Worker code, with a fixed origin/model allowlist.
- All local model profiles share one proxy API key. It is never committed or
  sent to the container. The operator must configure protected staging
  GitHub secret `GROKBOT_PROXY_API_KEY` with the existing local key.
- Staging deployment installs that secret into the Cloudflare Worker with
  `wrangler secret put` before publication.
- Full proxy HTTPS and Grok tool-call E2E **not yet validated**.
- The old direct Workers AI gateway implementation has been replaced for
  the branch; earlier direct-binding verification is historical only.
