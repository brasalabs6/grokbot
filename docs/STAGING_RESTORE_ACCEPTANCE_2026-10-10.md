# Staging recovery acceptance — 2026-10-10

Target: disposable session on the existing
`grokbot-sandbox-runtime-staging.guibelongtovi-a22.workers.dev` Worker.
No production traffic, production database or existing customer sessions.

Procedure: run the existing protected staging workflow using temporary UUIDs,
verify Grok ACP and actual tool-written workspace marker, stop with a container
snapshot, restart the same Durable Object with a new generation, verify the
marker file survived and the Brasamain proxy still performs real inference, and
destroy the disposable sandbox during cleanup.

This document records the **requested acceptance procedure**, not its outcome.
Do not label checkpoint restore as passed until the protected GitHub Actions
run concludes successfully. Snapshot recovery alone does not satisfy the R2
backup/restore release gate.

## Browser-driven regression (2026-10-11)

The first expanded browser test reached STOPPED after a real agent tool run and
checkpoint, but stalled after session/load on generation 2 because a successful
ACP load response did not refresh the Worker’s generation health marker.

Worker fix deployed successfully: [staging deployment 38138700646](https://github.com/brasalabs6/grokbot/actions/runs/38138700646).
The repaired bridge tracks only forwarded session/load RPCs and marks the
current generation healthy on a matched successful backend response for the
persisted ACP session; failures and stale generations cannot unlock READY.

Acceptance: rerun the protected browser workflow and demand a PASS on the
post-resume file check before marking this issue resolved.
