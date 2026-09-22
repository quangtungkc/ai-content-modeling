# Changelog

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
