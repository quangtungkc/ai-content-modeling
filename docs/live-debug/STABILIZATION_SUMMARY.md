# Stabilization Summary — v1.0.7

Date: 2026-09-23<br>
Run: `cmuc51vjr0006k5ycwa04qxgq`<br>
Project: `cmuc5pkc7000kk5ycb2lg2ksz`

## Outcome

The end-to-end production run reached Stage 5 and produced a validated final video. The final assembly completed with the same four persisted scene files; no scene was regenerated during the Stage-5 repair.

- Stage 1–5: PASS
- Final file: `generated-videos/cmuc5pkc7000kk5ycb2lg2ksz/final.mp4`
- Media: H.264/AAC, 720×1280, 15.14 seconds
- SHA-256: `145FE9637C5E7F62E2894E560D50950C055EEA3740A2F3FDAAAFF00219217D23`
- Run status: `SUCCEEDED`
- Execution lease: `null`

## Issues discovered and repaired

- ISSUE-001–006: Gemini conversation ownership, stale conversation replacement, strict new-user-turn confirmation, cookie-reset classification, structured error propagation, and same-profile session handling.
- ISSUE-007–012, ISSUE-020–021, ISSUE-029–030: SQLite compatibility, lifecycle settlement, runtime identity, storage-root consistency, monotonic resume, manual handoff locking, and bounded Flow submission confirmation.
- ISSUE-013–024, ISSUE-033, ISSUE-038–039, ISSUE-041: strict prompt/source fidelity, Stage-3 provider boundary, Flow image capture, asset-picker compatibility, native prompt input, and Start-frame/reference validation.
- ISSUE-025–035, ISSUE-040, ISSUE-042–047, ISSUE-049: provider-block evidence, non-retryable anti-abuse handling, manual checkpoint import, paced CDP interaction, and preservation of completed scenes. These repairs make provider failures safe and diagnosable; they do not bypass Google policy.
- ISSUE-036–037, ISSUE-050, and ISSUE-052: FFmpeg runtime discovery, Electron package allowlist, packaged `app.asar.unpacked` FFmpeg resolution, and safe staging when the configured source is inside the packaging output directory.
- ISSUE-048: Gemini video selection now routes through the Electron/CDP browser bridge instead of the legacy Veo API enqueue path.
- ISSUE-051: release-regression hardening for repository-bundled FFmpeg discovery, Gemini job requeue exclusion, and a test assertion that was too broad after the CDP file-input helper was added.

## Files and behavior changed

- Electron main/preload and browser lifecycle helpers now preserve structured errors and browser identity.
- Flow and Gemini CDP bridges now enforce provider markers, prompt/reference postconditions, bounded recovery, and safe checkpoint settlement.
- API, queue, worker, dashboard, and routing code now preserve provider selection and completed-scene checkpoints.
- FFmpeg is resolved from the packaged `app.asar.unpacked/electron/dist/ffmpeg` location before machine-wide fallbacks.
- Persistent state and ledger remain under `docs/live-debug/`; no secrets are stored there.

## Validation evidence

- Full Vitest suite: PASS after ISSUE-051 repair.
- TypeScript typecheck: PASS.
- ESLint: PASS with existing warnings and zero errors.
- Electron syntax checks: PASS.
- Production Next build: PASS.
- Electron packaging: PASS with the repository-bundled FFmpeg path.
- `git diff --check`: PASS.
- Final MP4 probe: PASS.

## Known limitations

- Google Flow may still return `FLOW_PROVIDER_UNUSUAL_ACTIVITY` before creating a provider job. The application pauses safely, does not retry indefinitely, and requires normal/manual provider recovery.
- The legacy Gemini/Veo API route requires a configured provider connection. The Gemini UI workflow uses CDP and is independent of that API credential.
