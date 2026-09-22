# Live Stabilization Summary

Date: 2026-09-22
Run: `cmu8ao66q004ak5jco5mgvf4w`
Project: `cmuagw9cx0001k5806rv7o518`

## Outcome

Stages 1–5 completed on the existing run. The final output was validated as an H.264/AAC MP4 at 720x1280, 15.14 seconds, with a successful FFmpeg decode check.

Final output:

`C:\Users\Admin\AppData\Roaming\ai-content-modeling\generated-videos\cmuagw9cx0001k5806rv7o518\final.mp4`

SHA-256: `9D680D0BCAFA79DC52614A5095F0DFD561D9A8BB0CE4C3E720F178A882AACB61`

## Issues discovered and fixes

- `ISSUE-001`–`ISSUE-005`: repaired strict Gemini submission confirmation, structured error propagation, and same-worktree Electron/renderer startup.
- `ISSUE-006`: removed dependency on the stale Gemini conversation ID and persisted only the confirmed app-owned conversation.
- `ISSUE-007`–`ISSUE-024`: repaired source modeling, prompt-fidelity, lifecycle settlement, runtime identity, data-preservation, and validation contracts recorded in the ledger.
- `ISSUE-025`–`ISSUE-032`: handled Flow provider unusual-activity responses as external, non-retryable blockers without bypassing provider controls; preserved completed scenes and resume checkpoints.
- `ISSUE-033`: made Frames mode and Start-frame binding fail closed before Generate.
- `ISSUE-034`–`ISSUE-035`: confirmed recurring provider-side blocks after the application-side binding repair; no unsafe retry loop was added.
- `ISSUE-036`: bound Stage 5 to a valid FFmpeg runtime and completed final assembly without regenerating scenes.

The complete per-issue evidence remains in `LIVE_DEBUG_LEDGER.md`; no issue history was deleted.

## Files and behavior changed

- Electron/Gemini lifecycle, IPC transport, Flow binding, runtime identity, cleanup, and final assembly paths were repaired.
- Facebook scanning now reads the 10 newest competitor videos and stores the actual view counts.
- Strict modeling contracts preserve timing, spatial relationships, ordered action beats, camera fields, and source-scene mapping.
- Stage 4 and Stage 5 preserve completed artifacts and resume from the first incomplete checkpoint.

## Data and storage safety

- No database reset, destructive migration, seed reset, drop, or truncate was run.
- `C:\Users\Admin\AppData\Roaming\ai-content-modeling` was preserved; generated assets and browser profiles remain available.
- `.env` and local secrets were not replaced.

## Validation record

- Targeted regression tests: PASS.
- Full Vitest suite: PASS — 79 test files, 862 tests, with the validated FFmpeg runtime.
- Typecheck: PASS.
- Lint: PASS with 0 errors; existing non-blocking warnings remain.
- Syntax and diff checks: PASS.
- Production build and installer packaging: PASS.
- Stage 5 live validation: PASS; final MP4 persisted and decoded successfully.

## Architecture and provider limitations

- Flow unusual-activity is an external Google provider block. The app reports it structurally, stops automatic retries, and waits for normal/manual provider recovery. It does not rotate accounts, spoof fingerprints, rotate proxies, or bypass anti-abuse controls.
- The packaged runtime must contain an executable Windows FFmpeg binary; release packaging verifies this before building the installer.
