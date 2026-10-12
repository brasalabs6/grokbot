# GrokBot

GrokBot is a Next.js control plane for running real **Grok Build coding agents** in isolated Cloudflare Containers. It connects to Grok over the Agent Client Protocol (ACP) and uses the operator's existing authenticated Brasamain OpenAI-compatible inference proxy.

> **Status: internal V1 preview / incomplete integration.** The Cloudflare agent runtime passed a real tool-execution smoke test, and a Vercel frontend build is online. This is **not yet a production-ready app**, because the independent PostgreSQL deployment and browser acceptance tests are still pending.

## System

- **Web:** Next.js 16, React 19, Auth.js, dashboard, session detail, ACP chat, PTY terminal and read-only file explorer.
- **Control plane:** authenticated REST endpoints and PostgreSQL/Drizzle state, operation idempotency and per-session access control.
- **Runtime:** Cloudflare Worker + Durable Object + Sandbox/Container, pinned Grok Build CLI, generation-fenced sessions and WebSocket bridge.
- **Inference:** `https://cf-ai-rate-proxy.brasaimainstream.workers.dev/v1`; default model `cf-qwen3.8-27b`. Real proxy credentials are secret bindings in the trusted Worker and are never stored in container images.
- **Security:** signed expiring WebSocket tickets, signed exact-prompt run capabilities, narrow egress interception, no open terminal route, isolated workspaces.

## Evidence

The core coding-agent feasibility gate has **passed**. [GitHub Actions staging E2E](https://github.com/brasalabs6/grokbot/actions/runs/38017545630) confirms that Grok started in a Cloudflare Container, the Qwen proxy responded via HTTPS, Grok executed a tool and wrote a file, PTY/tmux reconnection worked, and the disposable sandbox was stopped.

For engineering evidence and implementation limitations see [E2E report](docs/EVIDENCE-STAGING-QWEN-2026-10-09.md), [status](docs/IMPLEMENTATION_STATUS_V1.md) and [proxy architecture decision](docs/ADR-002-PROXY-INFERENCE.md).

## Source documents

- [Full V1 specification](docs/FEATURE_SPEC_V1.md)
- [Proxy decision ADR](docs/ADR-002-PROXY-INFERENCE.md)
- [Staging E2E acceptance](docs/EVIDENCE-STAGING-QWEN-2026-10-09.md)

## Running locally

Requires Node.js 24, pnpm 10.32.1 and an **independent PostgreSQL** database. Copy `.env.example` to `.env.local` and configure values there. **Never commit your secrets.**

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The app needs `POSTGRES_URL`, `AUTH_SECRET`, `FEATURE_AGENT_RUNTIME=1`, `CLOUDFLARE_RUNTIME_URL`, `CONTROL_PLANE_SERVICE_SECRET`, and `RUNTIME_TICKET_SECRET` to provide complete agent sessions. Its Cloudflare sandbox Worker must have matching control-plane and signing credentials and the proxy API key as a Worker secret. The `FEATURE_AGENT_RUNTIME` flag remains off in preview until the backend is configured and tested.

## Validation

```bash
pnpm exec tsc --noEmit
pnpm exec tsx --test tests/unit/*.test.ts
pnpm check
pnpm exec playwright test
```

The Cloudflare runtime also has a dedicated CI suite in `.github/workflows/sandbox-runtime.yml` with an isolated Docker/ACP test; staging E2E runs only through the protected workflow `.github/workflows/staging-e2e.yml`. Never run those against production without deliberate environment scoping.

## Deployment

Vercel project `grokbot` is connected to the feature branch for protected preview deployments. The Cloudflare staging Worker is `grokbot-sandbox-runtime-staging`. No merge to `main` or production release should be performed until all application, database, recovery, test and security gates pass.
