# ADR-002 — Use the operator's existing Cloudflare inference proxy

**Status:** Accepted for the GrokBot V1 staging implementation — 2026-10-09

## Decision

GrokBot does **not** call the Cloudflare Workers AI API directly. Its Grok Build
process uses the existing operator-managed OpenAI-compatible proxy:

- Base URL: `https://cf-ai-rate-proxy.brasaimainstream.workers.dev/v1`
- API route: `POST /v1/chat/completions`
- Backend protocol: `chat_completions`
- Default Grok model: `cf-qwen3.8-27b` → `@cf/qwen/qwen3.8-27b`
- Agent session summary/image description: `cf-glm-5.3-flash` → `@cf/zai-org/glm-5.3-flash`
- All other aliases are maintained in `services/sandbox-runtime/config/grok-models.toml`.

The model profile is a **redacted copy of the non-secret model sections** of the
operator's local `~/.grok/config.toml`. It does not include personal MCP
connections, local settings, or authentication tokens.

## Credential boundary

All locally configured proxy models use one shared API key. The real key is
stored as `GROKBOT_PROXY_API_KEY` in a protected staging GitHub environment
and delivered by GitHub Actions via `wrangler secret put` to the Cloudflare
Worker's secret binding. Never write it to:

- Git, Docker layers, build args, workspace snapshots, terminal output;
- Process argv, URL query strings, ACP messages or CI artifact logs;
- Sandbox container environment variables.

The local Grok profile contains only the deliberate
`grokbot-internal-placeholder` key. The Worker intercepts outbound HTTPS
for `cf-ai-rate-proxy.brasaimainstream.workers.dev` and replaces authorization
with the trusted secret. All other container outbound traffic remains blocked.

The Cloudflare gateway enforces:

1. Exact HTTPS origin and `POST /v1/chat/completions`, without query strings;
2. A fixed allowlist of model identifiers from the operator's profiles;
3. Size/message limits and JSON validation;
4. Fresh `Authorization: Bearer` from Worker secrets only;
5. `redirect: manual` to avoid credential leakage across hosts;
6. Unchanged proxy response body, including OpenAI tool calls and SSE;
7. No-store responses and no logging of prompt bodies or credentials.

The old direct `AI.run` binding and hardcoded `@cf/openai/gpt-oss-120b`
inference route were removed from the runtime.

## Operator action (one-time, staging)

For security reasons the key is not transferred automatically between the
local machine and connected services. Copy the `api_key` from the default
`[model."cf-qwen3.8-27b"]` section of your local `~/.grok/config.toml`
directly into **GitHub → repository Settings → Environments → staging →
Environment secrets** with the name `GROKBOT_PROXY_API_KEY`.

Do not paste the value into chat. The existing deployment workflow now checks
this secret and installs it into the Cloudflare Worker before deployment.

## Acceptance gates

- [ ] GitHub Actions `sandbox-runtime` TypeScript, Docker, offline ACP checks pass.
- [ ] Protected staging deployment succeeds with `GROKBOT_PROXY_API_KEY`.
- [ ] An isolated container reaches the existing proxy through HTTPS and
      receives an OpenAI-compatible response with model Qwen 3.8.
- [ ] Grok ACP creates a new session and performs one real tool call using
      that model, verified by a file created inside the sandbox.
- [ ] The response supports tool calls and streaming, and denies invalid
      routes/models and stale run tickets.
- [ ] Disposable sandbox stops even if the smoke fails.
- [ ] No application production deployment or merge into `main` until
      independent frontend, database, lifecycle, recovery, security and
      acceptance gates pass.

## Rollback

Deploy the previous known-good staging Worker/image if the proxy test fails.
Do not weaken authentication, disable TLS verification or allow arbitrary
network egress merely to make the smoke pass.
