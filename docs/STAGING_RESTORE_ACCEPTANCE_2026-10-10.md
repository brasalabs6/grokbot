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
