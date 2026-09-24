# Changelog

## 1.0.10 — 2026-09-24

### Fixed

- Enforced exact Stage 2 storyboard parity: the generated storyboard must keep the source scene count, order, continuous scene numbers, and source-scene mapping.
- Hardened Gemini video submission through CDP: after the DOM send and one pointer recovery, the composer must no longer contain the prompt; otherwise the run stops with `GEMINI_SUBMISSION_NOT_CONFIRMED` instead of waiting for a false generation.
- Added deterministic Edge executable fallbacks for Windows installations where `ProgramFiles` environment variables are incomplete.
- Added an Electron-side local image validation fallback for packaged/runtime cases where the renderer cannot read generated image URLs; continuity checks still hash the actual project files and reject duplicate scene images.
- Sanitized provider-only source URLs and named third-party style triggers before prompt sealing while preserving the authoritative scene constraints.
- Recovered a killed Stage 2 execution persisted as `running` into the existing paused/resume checkpoint instead of treating it as ambiguous.
- Increased the timeout of the FFmpeg-backed exact-text regression case so the full suite remains stable under parallel load; production behavior is unchanged.

### Validation

- End-to-end run `cmuevtc5q0002k5tcbox0a2t4` completed Stages 1–5 with `SUCCEEDED`.
- The run created one source-faithful scene, two images, one scene video, and a final MP4.
- Final media validation: H.264, 720×1280, 9:16, 10.01 seconds; project video storage retained only `final.mp4` after cleanup.
- Full test, typecheck, lint, syntax, build, packaged-content, and installer checks are required before publication.

## 1.0.8 — 2026-09-23

### Fixed

- Packaged the second video-generation route as a first-class Gemini-through-CDP flow alongside Google Flow, with provider selection preserved in the dashboard and queue payload.
- Fixed the Gemini video send path using an unbound conversation variable after the reference image was attached.
- Added an explicit 9:16 output directive to the sealed video prompt when the Gemini Video UI does not expose a ratio control; 16:9 remains explicit when selected.
- Kept the current `/videos` composer readiness gate, `Tệp` upload fallback, reference-preview confirmation, and bounded page-reset recovery in the release build.

### Validation

- Added regression coverage for Gemini-CDP executor routing, aspect-ratio prompt sealing, and the Gemini video send-boundary variable regression.

## 1.0.7 — 2026-09-23

### Fixed

- Completed the stabilization fixes recorded in `docs/live-debug/LIVE_DEBUG_LEDGER.md` for Gemini conversation ownership, strict send confirmation, structured error propagation, Electron/main-renderer worktree identity, Flow CDP routing, reference-frame validation, safe provider-block settlement, and final video assembly.
- Gemini video selection now uses the Electron/CDP browser route instead of requiring a Veo API credential.
- Packaged Electron builds resolve the bundled FFmpeg binary from the electron-builder `app.asar.unpacked` location.
- Electron packaging now stages a configured FFmpeg source before cleaning and recreating `electron/dist`.
- Post-assembly QA tests resolve the same repository-bundled FFmpeg runtime during development and release validation.
- Background recovery excludes both Flow and Gemini browser jobs from generic stale-job requeueing.

### Changed

- Stage 3 image generation and Stage 4 browser video generation preserve the requested provider boundaries and checkpoint semantics.
- Flow interactions use bounded human-paced waits, one bounded recovery, exact Start-frame confirmation, and structured non-retryable unusual-activity failures.
- Stage 5 validates the final H.264/AAC MP4 before persisting a successful run checkpoint.

### Added

- `docs/live-debug/STABILIZATION_SUMMARY.md` with the issue families, repairs, validation evidence, and known limitations from the end-to-end stabilization run.
- Regression coverage for packaged FFmpeg resolution, Gemini CDP video routing, provider-block settlement, structured errors, and runtime identity.

### Migration notes

- Existing AppData, database records, generated media, browser profiles, and `.env` are retained. No destructive migration or reset is required.
- A release build on this Windows host must use the repository-bundled executable through `MODELING_AI_FFMPEG_PATH` because the local `ffmpeg-static` artifact is not executable on this host.

### Known limitations

- Google Flow anti-abuse/unusual-activity blocks remain external provider decisions. The app stops automatic retries and supports manual recovery; it does not bypass those controls.
- The legacy Veo API route still requires an explicitly configured VEO/GEMINI connection; the Gemini UI option uses the CDP route and does not silently fall back to the API.

## 1.0.6 — 2026-09-22

### Fixed

- Fixed a startup crash in the 1.0.5 installer caused by three Electron main-process helper modules omitted from `app.asar`: `temp-cleanup.cjs`, `ipc-contract.cjs`, and `dev-runtime-identity.cjs`.
- The clean-install smoke now fails before launch if any required Electron main-process module is absent from the packaged archive.

## 1.0.5 — 2026-09-22

### Fixed

- Facebook competitor scanning now limits each channel to the 10 newest videos and preserves the platform's real view counts.
- Gemini send confirmation now requires ownership of the intended conversation and an exact new user turn; composer clearing alone is never treated as success.
- Gemini conversation resets, authentication failures, IPC structured errors, and renderer/main errors are preserved through the pipeline instead of being replaced by generic failures.
- Stale Gemini conversation IDs are validated and replaced only after a new app-owned conversation is confirmed.
- Electron development runtime now verifies that main and renderer use the same worktree and rejects stale or unexpected port occupants.
- Flow video generation verifies Frames mode and Start-frame binding before submission, while provider unusual-activity blocks are structured, non-retryable, and checkpoint-safe.
- Final video assembly now uses a validated FFmpeg runtime and completed video jobs remain preserved across resume.
- Modeling tests no longer depend on private AppData evidence logs; production-shaped assertions use deterministic fixtures.

### Changed

- Stage lifecycle settlement keeps `executionLease=null` on failure and resumes only from the first incomplete checkpoint.
- Stage 5 validates the final MP4 with FFmpeg before marking the run successful.
- The desktop preparation step validates FFmpeg with `-version` and copies the explicitly configured valid binary into the packaged runtime.

### Added

- Persistent live-debug ledger/state under `docs/live-debug/`.
- Development runtime identity and port ownership guards.
- Structured provider, IPC, and cleanup diagnostics.
- Stabilization summary for the completed end-to-end run.

### Migration notes

- Existing AppData, database records, browser profiles, generated assets, and `.env` are retained. No destructive migration or reset is required.
- A clean release build must provide a Windows FFmpeg executable through `MODELING_AI_FFMPEG_PATH` when the installed `ffmpeg-static` artifact is not executable on the build host.

### Known limitations

- Google Flow anti-abuse/unusual-activity blocks are external provider decisions. The application stops automatic retries and requires normal/manual provider recovery; it does not bypass those controls.
