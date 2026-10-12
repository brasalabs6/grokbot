# Staging acceptance evidence — GrokBot + Brasamain proxy

Date: 2026-10-09 America/Sao_Paulo (2026-10-10 UTC).

**Result: PASS — live coding agent with real tools.**

Source: https://github.com/brasalabs6/grokbot/actions/runs/38017545630

| Acceptance check | Observed |
| --- | --- |
| Cloudflare disposable sandbox | Started, generation 1 |
| Interactive terminal / tmux | Commands and reconnect passed |
| Grok ACP | Port 2419 reachable, initialize and session/new passed |
| Existing Brasamain Qwen 3.8 proxy | HTTP 200, OpenAI-compatible choices, usage |
| Actual coding-agent tool execution | Agent wrote a uniquely marked file under /workspace, file contents re-read and verified |
| Cleanup | Temporary sandbox stopped |
| Elapsed | 23 seconds |
| GitHub Actions outcome | Success |

Deployment run: https://github.com/brasalabs6/grokbot/actions/runs/38017409792

Container/runtime validation run: https://github.com/brasalabs6/grokbot/actions/runs/38017281799

The implementation uses the existing protected Brasamain proxy and the default Qwen model from the operator's local Grok configuration. API credentials remain in Cloudflare secret bindings. Cloudflare Containers exec launches require explicit non-secret environment values for trusted HTTPS, even when those values appear in the image or container start configuration.

**Gate closed:** core feasibility of Grok ACP + proxy inference + real tools and PTY in a Cloudflare sandbox.

**Not yet validated:** deployed frontend, PostgreSQL migrations, R2 recovery/restore, concurrency and interrupt recovery, multi-user permissions, long-running execution, full test suite and production release. PR #1 remains a draft with no main merge.
