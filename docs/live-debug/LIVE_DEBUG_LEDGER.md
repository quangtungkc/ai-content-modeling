# Live Debug Ledger

This ledger is the persistent source of truth for the live stabilization workflow.

## Protocol

The lifecycle is strictly user-controlled:

`RUN → FAIL → INVESTIGATE → RECORD → STOP`

`USER REPAIR → REPAIR → TEST → RECORD → STOP`

`USER CONTINUE → RESUME SAME RUN → repeat until final video → regression → prepare release`

The agent must not automatically repair a discovered failure, resume after repair, create a replacement run, skip validators, reset the database, or mutate historical successful runs. Every production failure must settle before read-only investigation. Every issue and repair must be recorded here before stopping.

## Current State

- State file: `docs/live-debug/LIVE_DEBUG_STATE.json`
- Active run: `cmu8ao66q004ak5jco5mgvf4w`
- Source video: `cmu83lkni004hk5ek8uuibbnn` (`@buzzinanimation`, 124K views)
- Channel: `Chubby Chaos` (`cmu83a6560006k5bsl13ejsoh`)
- Current issue: `none` (last repaired issue: `ISSUE-011`)
- Run status: `PAUSED` (authoritative DB value; Stage 2 completed successfully)
- Last completed stage: `2`
- Resume target: `null` (ready for explicit continuation to Stage 3)
- Execution lease: `null`
- Next action: wait for an explicit user continuation command; do not resume automatically

## Issue History

### ISSUE-001

- `ISSUE_ID`: `ISSUE-001`
- `DISCOVERED_AT`: `2026-09-19T11:19:12.115Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `0`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation`
- `FIRST_DIVERGENCE`: `CONTENT_PROJECT_CREATION` during Gemini conversation reopen/preflight
- `SYMPTOM`: `Không tạo được Content Project và phân cảnh.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 1 completed; Modeling Idea cmu8aogti004ck5jcd4rp2f4m was created and approved. The run checkpoint contained an active Gemini conversation binding and execution lease was still active before failure.`
- `EXPECTED_STATE`: `Stage 2 reopens the exact Gemini conversation persisted by Stage 1, verifies its conversation identity, then submits the Content Project prompt.`
- `ACTUAL_STATE`: `The persisted binding referenced /app/<conversation-id>, but after reopen the managed Gemini target remained at https://gemini.google.com/app with no conversation id. Identity verification failed before the Stage 2 prompt was accepted.`
- `ROOT_CAUSE`: `The Edge/CDP Gemini reopen path did not restore the persisted conversation URL. The runtime correctly failed closed on the identity mismatch, but the navigation handshake did not establish the requested conversation target.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs:2523-2541 via electron/gemini-conversation-lifecycle.cjs:70-72`
- `FAILURE_CALL_CHAIN`: `runAutomaticPipeline → createContentProject → desktopGemini.developProject → IPC gemini-browser:develop-project → runBrowserDevelopedIdeaJobUnlocked → preflightGeminiForRun → waitForGeminiConversationIdentity → assertConversationReady`
- `RELEVANT_EVIDENCE`: `AutomationRun status FAILED; lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; projectId=null; executionLease=null. RuntimeFailure codes CONTENT_PROJECT_CREATION_FAILED and DESKTOP_RUNTIME_INTERRUPTED both contain GEMINI_CONVERSATION_URL_MISMATCH. TroubleshootingIncident b9df0991-4f33-471a-a2f3-edeb2d7d09cc records expected stage PROJECT and actual generic Gemini /app. browser-actions.ndjson sequence 142 records persisted conversation URL /app/<conversation-id>, immediate URL /app, final URL /app, observedConversationId=null, result=FAIL.`
- `RECOMMENDED_REPAIR`: `Repair only the Edge/CDP conversation navigation handshake: after Page.navigate, verify the final managed target URL/path matches the requested conversation; if the target remains generic /app, reacquire the managed Gemini page and perform one bounded navigation retry, then fail closed with explicit diagnostics. Never relax identity checks or treat /app as the bound conversation. Add a regression test for generic /app versus a persisted /app/<conversation-id> target.`
- `CHOSEN_REPAIR`: `Updated the Edge/CDP conversation navigation handshake. EdgeWebContents.loadURL now returns the final managed URL; bound conversation navigation verifies the returned identity, reacquires the managed Gemini page once, retries once, and still fails closed. Generic /app remains invalid and login redirects produce an explicit environment error.`
- `FILES_CHANGED`: `electron/edge-gemini-cdp.cjs; electron/main.cjs; electron/gemini-conversation-lifecycle.cjs; electron/edge-gemini-cdp.test.ts; electron/gemini-conversation-lifecycle.test.ts; docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `conversationNavigationDisposition regression coverage; Edge/CDP navigation/reacquire source contract coverage.`
- `TEST_RESULTS`: `Targeted Vitest PASS: 2 files, 18 tests. Typecheck PASS. Node syntax checks PASS for main.cjs, edge-gemini-cdp.cjs and gemini-conversation-lifecycle.cjs. Next production build PASS with existing lint warnings only. git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS in the resumed run: the repaired Edge/CDP navigation recorded a matching persisted conversation URL and identity PASS before the Stage 2 prompt was submitted.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null.`
- `NOTES`: `The exact conversation URL/id is intentionally redacted from this ledger; it remains in the runtime checkpoint and evidence records. New user screenshot shows https://gemini.google.com/app with a visible Sign in button, proving that the currently viewed Gemini window is not authenticated. It does not yet prove that this is the same managed EdgeGeminiProfile used by the failed run; Stage 1 had succeeded in the managed runtime. The repair preserves fail-closed identity validation. Current DB checkpoint verified read-only: lastCompletedStage=1, resumeTarget=CONTENT_PROJECT_CREATION, executionLease=null, projectId=null. No database reset, destructive cleanup, historical-run mutation, or new run was performed.`

### ISSUE-002

- `ISSUE_ID`: `ISSUE-002`
- `DISCOVERED_AT`: `2026-09-19T11:48:16.398Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `1`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / CONTENT_PROJECT_DEVELOP`
- `FIRST_DIVERGENCE`: `AUTH_SESSION_ROUTE_RESET_AFTER_DOM_SUBMISSION` at `2026-09-19T11:44:13.904Z–11:44:14.600Z`, before any valid Gemini response or model-generation request existed.
- `SYMPTOM`: `The runtime treated a cleared composer as a successful submission, but Gemini never rendered a user turn, never exposed a generation request, and never produced a response. The command waited 242930 ms, timed out, and then the finalizer reported conversation identity loss.`
- `LAST_CONFIRMED_GOOD_STATE`: `The repaired conversation navigation and identity checks passed. The managed page was at the exact persisted conversation URL, the composer had the prompt, and DOM input/keydown/keyup events were observed immediately before the route reset.`
- `EXPECTED_STATE`: `After send, the exact bound conversation remains active, a user message is rendered, a Gemini generation request starts, and one complete valid Content Project JSON response is captured.`
- `ACTUAL_STATE`: `At 2026-09-19T11:44:13.904Z an accounts.google.com/RotateCookiesPage frame navigated inside the Gemini page. The exact conversation route was still reported at 11:44:14.051Z, then the main target changed to generic https://gemini.google.com/app at 11:44:14.591Z. The composer-cleared signal arrived at 11:44:14.691Z, but userMessageRenderedAt, networkRequestStartedAt, firstResponseTextAt, and all response milestones remained null. The page ended in NEW mode with zero user/assistant turns; the renderer heartbeat stayed healthy. The 240-second timeout and finalizer URL mismatch were downstream effects.`
- `ROOT_CAUSE`: `Confirmed failure mechanism: Gemini's managed browser session performed an authentication-cookie rotation, and the Gemini SPA reset the bound conversation to generic /app during the send sequence. Because submission confirmation relied on DOM_COMPOSER_CLEARED, the runtime falsely considered the command submitted, waited without an actual model request, then timed out. The exact deeper reason why Google rotated the cookie (expired session, account state, or Google policy) is not proven by this run.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED for auth/cookie-rotation → conversation-route-reset → no-generation-request; PROVISIONAL/UNKNOWN for the deeper reason that triggered the cookie rotation.`
- `ERROR_THROW_SITE`: `electron/main.cjs:986-987 (GEMINI_COMMAND_TIMEOUT); electron/main.cjs:2598 (conversation finalizer identity failure)`
- `FAILURE_CALL_CHAIN`: `runAutomaticPipeline → createContentProject → desktopGemini.developProject → runBrowserDevelopedIdeaJobUnlocked → runGeminiJsonCommandWithFormatRetry → runGeminiJsonCommand → submitGeminiCommand → DOM_COMPOSER_CLEARED false-positive → auth cookie rotation / SPA route reset → waitForGeminiResponse timeout → persistGeminiConversationAfterStep → assertConversationReady`
- `RELEVANT_EVIDENCE`: `gemini-navigation-diagnostics.ndjson` captured RotateCookiesPage at 11:44:13.904Z, exact conversation at 11:44:14.051Z, and generic /app at 11:44:14.591Z; finalWindow URL was generic /app. `gemini-latency-diagnostics.ndjson` recorded composerClearedAt=11:44:14.691Z, userMessageRenderedAt=null, networkRequestStartedAt=null, firstResponseTextAt=null, timeoutAt=11:48:16.350Z, totalCommandMs=242930, and networkGenerationRequestIdentified=false. Browser-actions sequences 1-3 show navigation/identity PASS; sequences 6-10 show only the local submission signal; sequences 11-15 show no response; sequence 16 records TIMEOUT; sequence 20 records AFTER_STEP_FINALIZER GEMINI_CONVERSATION_URL_MISMATCH. RuntimeFailure cmu8bpyir004uk5jcehmlce7l and renderer failure cmu8bpyiq004sk5jcl1ytfpwq were recorded at 2026-09-19T11:48:16.514Z. DB status is PAUSED with lastCompletedStage=1, failedStage=2, resumeTarget=CONTENT_PROJECT_CREATION, projectId=null, executionLease=null.`
- `RECOMMENDED_REPAIR`: `Repair the authenticated-session and submission-confirmation boundary: preflight must verify an authenticated Gemini identity and stable bound conversation; DOM composer clearing alone must never confirm submission; require a rendered user turn or a verified generation request. Detect RotateCookiesPage, auth redirects, and route reset to generic /app immediately and fail closed with an explicit GEMINI_AUTH_REQUIRED or GEMINI_CONVERSATION_RESET_DURING_SEND diagnostic instead of waiting 240 seconds. Do not bypass identity validation or merely increase the timeout.`
- `CHOSEN_REPAIR`: `Strict user-turn submission confirmation using exact normalized prompt identity and baseline turn counts; conversation-reset detection during the bounded send-confirmation window; one bounded authenticated recovery attempt that reopens the exact conversation and resends the same prompt; generation evidence required after confirmed send; response-completion wait starts only after confirmed user turn; primary reset error is preserved over finalizer URL mismatch. New-conversation handling accepts only the original /app entry route or the newly assigned /app/<conversation-id>; bound conversations remain exact-URL only.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-browser-lifecycle.cjs; electron/gemini-browser-lifecycle.test.ts; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `ISSUE-002 strict submission contract coverage for composer-clear false positives, exact new user turn, old matching turns, prompt mismatch, deterministic normalization, new-conversation ownership, reset detection, one-time recovery, auth stop, response-timer gating, and primary-error preservation.`
- `TEST_RESULTS`: `Targeted Vitest PASS: 4 files, 97 tests. Typecheck PASS (npx tsc --noEmit). Node syntax checks PASS for main.cjs and gemini-browser-lifecycle.cjs; git diff --check PASS. Next production build PASS with existing unrelated lint warnings only.`
- `LIVE_VALIDATION`: `Focused isolated Gemini validation PASS without runId and without resuming AutomationRun. Final command state=VALIDATED; GEMINI_CONVERSATION_OWNERSHIP=PASS; GEMINI_NEW_USER_TURN_CONFIRMED=YES; GEMINI_SUBMISSION_CONFIRMED=YES via DOM_USER_TURN_EXACT; userTurnDelta=1; exactPromptDelta=1; GEMINI_GENERATION_STARTED=YES via NETWORK_GENERATION_REQUEST; GEMINI_RESPONSE_COMPLETION=PASS; GEMINI_RESPONSE_NONEMPTY=YES; valid JSON extraction returned. Cookie rotation was not naturally triggered in this focused run; synthetic regression coverage verifies one bounded recovery and fail-closed second reset.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null; attemptCount=1.`
- `NOTES`: `The exact failure mechanism is established: cookie/navigation reset was accepted as submission because composer-clear was treated as confirmation. The repair removes that false condition. Runtime diagnostics from the first focused attempt exposed and fixed a second implementation defect: Gemini user-query innerText includes the accessibility label and collapsed preview, so the reader now hashes only .query-text-line content. The final isolated validation passed. The authoritative DB read after repair reports status=FAILED, lastCompletedStage=1, failedStage=2, resumeTarget=CONTENT_PROJECT_CREATION, projectId=null, and executionLease=null; the prior PAUSED note was stale. No DB mutation was performed to force PAUSED, and no production resume, database reset, destructive cleanup, historical-run mutation, or new run was performed.`

### ISSUE-003

- `ISSUE_ID`: `ISSUE-003`
- `REGRESSION_OF`: `ISSUE-002` (linked regression; strict false-submission prevention remained effective)
- `DISCOVERED_AT`: `2026-09-19T16:32:32.991Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `2`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / CONTENT_PROJECT_DEVELOP`
- `FIRST_DIVERGENCE`: `SECOND_AUTH_COOKIE_ROTATION_DURING_RECOVERY_SEND` at approximately `2026-09-19T16:32:31.678Z–16:32:32.015Z`, when a second `accounts.google.com/RotateCookiesPage` navigation reset the exact Gemini conversation to generic `/app` before any new user turn.
- `SYMPTOM`: `The first cookie-rotation reset was detected and recovered once. The recovery send reset again. The runtime recorded the second reset, but the surfaced primary error became generic GEMINI_SUBMISSION_FAILED instead of the required reset-specific error. The UI therefore showed only the generic Content Project failure.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 1 was complete; the exact persisted conversation was reopened successfully for Stage 2; the first reset was detected; the exact conversation was reopened and baseline turns were re-established for the one allowed recovery attempt.`
- `EXPECTED_STATE`: `After the one recovery attempt resets again, fail immediately with primary GEMINI_CONVERSATION_RESET_DURING_SEND and include attempt=2, expected URL, actual URL, user-turn delta, assistant-turn delta, and generation-request evidence. Do not fall through to a generic submission error or response wait.`
- `ACTUAL_STATE`: `Initial send reset from the exact conversation URL to generic /app with reason COOKIE_ROTATION and userTurnDelta=0/assistantTurnDelta=0. One recovery reopened the exact URL and resent. The second send reset again to generic /app with reason COOKIE_ROTATION and deltas 0/0. Browser-actions then persisted error=GEMINI_SUBMISSION_FAILED; the finalizer emitted only secondary diagnostics. The run settled FAILED, attemptCount=2, lastCompletedStage=1, failedStage=2, resumeTarget=CONTENT_PROJECT_CREATION, contentProjectId=null, executionLease=null.`
- `ROOT_CAUSE`: `Specific GEMINI_CONVERSATION_RESET_DURING_SEND was detected after the bounded recovery was exhausted, but submitGeminiCommand fell through to the generic GEMINI_SUBMISSION_FAILED fallback. Because there was no immediate terminal throw for the second reset, the required primary reset classification was masked.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs:947-969, specifically the second-reset branch falls through to the generic failure-code assignment at approximately lines 965-969.`
- `FAILURE_CALL_CHAIN`: `runAutomaticPipeline → createContentProject → desktopGemini.developProject → runBrowserDevelopedIdeaJobUnlocked → runGeminiJsonCommandWithFormatRetry → runGeminiJsonCommand → submitGeminiCommand → first reset detection → one bounded recovery → second reset detection → generic GEMINI_SUBMISSION_FAILED fallback → finalizer secondary failure.`
- `RELEVANT_EVIDENCE`: `browser-actions.ndjson command 0e119920-9c3f-4202-8a27-d219dc5428ca recorded reset attempt=1 and reset attempt=2, both reason=COOKIE_ROTATION, expectedUrl=https://gemini.google.com/app/27f9c19a43da8886, actualUrl=https://gemini.google.com/app, userTurnDelta=0, assistantTurnDelta=0, generationRequestObserved=YES; the recovery was recorded as RESEND_ALLOWED_ONCE; lifecycle sequence 22 recorded error=GEMINI_SUBMISSION_FAILED. Navigation diagnostics recorded RotateCookiesPage followed by generic /app on both sends. The authoritative DB state settled FAILED with attemptCount=2 and executionLease=null.`
- `RECOMMENDED_REPAIR`: `In submitGeminiCommand, immediately throw GEMINI_CONVERSATION_RESET_DURING_SEND after a reset on the already-used recovery attempt. Include attempt=2, expectedUrl, actualUrl, userTurnDelta, assistantTurnDelta, and generationRequestObserved. Preserve this as the primary error through runGeminiJsonCommand and the finalizer. Add regression tests for second recovery reset classification and diagnostic fields. Do not loosen strict submission confirmation or add another retry.`
- `CHOSEN_REPAIR`: `Make the structured reset failure terminal after the one recovery budget is exhausted; preserve its code/context on the command lifecycle; rethrow the same error through the Gemini job and keep finalizer failures secondary.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-browser-lifecycle.cjs; electron/gemini-browser-lifecycle.test.ts; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `ISSUE-003 structured reset error context and lifecycle persistence; source-contract coverage proving the exhausted reset branch throws before the generic fallback.`
- `TEST_RESULTS`: `Targeted Vitest PASS: 4 files, 101 tests. Typecheck PASS: npx tsc --noEmit. Syntax PASS: node --check electron/main.cjs, electron/gemini-browser-lifecycle.cjs, electron/edge-gemini-cdp.cjs, electron/gemini-conversation-lifecycle.cjs. git diff --check PASS.`
- `LIVE_VALIDATION`: `Synthetic/unit validation PASS for the second-reset branch. No production resume or live Gemini validation was run by this repair, as required. The run remains at the settled FAILED checkpoint from the prior CONTINUE.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; attemptCount=2; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null; executionLease=null.`
- `NOTES`: `This was not a recurrence of the original composer-clear false positive: the strict user-turn contract prevented submission success. The repair now preserves the reset as the primary structured failure, including expected/actual URL, recovery attempt/budget, turn deltas, generation evidence, composer-cleared state, authentication state when known, and cookie-rotation evidence. Finalizer URL mismatch remains secondary. No production resume, new run, DB mutation, database reset, destructive cleanup, historical-run mutation, or runtime-data deletion was performed by this repair. Next action is WAIT_FOR_USER_CONTINUE_COMMAND.`

### ISSUE-004

- `ISSUE_ID`: `ISSUE-004`
- `FOLLOW_UP_OF`: `ISSUE-003`
- `DISCOVERED_AT`: `2026-09-19T17:01:54.831Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `3`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / CONTENT_PROJECT_DEVELOP`
- `FIRST_DIVERGENCE`: `RENDERER_PIPELINE_ERROR_SWALLOWED_AFTER_PRIMARY_GEMINI_RESET`, after the Electron IPC rejection carried the structured reset error but before the pipeline wrote the settled AutomationRun failure.
- `SYMPTOM`: `The repaired Electron command correctly preserved GEMINI_CONVERSATION_RESET_DURING_SEND and the finalizer recorded URL mismatch only as secondary evidence. However, the renderer displayed and persisted only the generic error Không tạo được Content Project và phân cảnh.; the AutomationRun.error field did not retain the primary code/context.`
- `LAST_CONFIRMED_GOOD_STATE`: `The same-run Stage 2 command reached terminal FAILED with primaryErrorCode=GEMINI_CONVERSATION_RESET_DURING_SEND, structured primaryErrorContext, submissionConfirmed=false, userTurnDelta=0, assistantTurnDelta=0, and response wait not started. The finalizer secondary failure explicitly recorded primaryFailurePreserved=true.`
- `EXPECTED_STATE`: `The exact primary Gemini error must survive createContentProject, runAutomaticPipeline, stage settlement, AutomationRun.error, and the debug/runtime report. The settled run should expose GEMINI_CONVERSATION_RESET_DURING_SEND rather than replace it with a generic null-project message.`
- `ACTUAL_STATE`: `src/components/viral-dashboard.tsx createContentProject catches the desktopGemini.developProject rejection, reports it, then returns null. runAutomaticPipeline subsequently executes if (!project) throw new Error("Không tạo được Content Project và phân cảnh."); and updateAutomationRun persists that generic message. The read-only AutomationRun API showed status=FAILED, attemptCount=3, lastCompletedStage=1, failedStage=2, executionLease=null, projectId=null, and error=Không tạo được Content Project và phân cảnh.`
- `ROOT_CAUSE`: `The renderer helper consumes the original Error after reporting it and returns null, so the pipeline caller cannot preserve the structured primary failure and deliberately creates a new generic Error.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/components/viral-dashboard.tsx:671-682 catches and returns null; src/components/viral-dashboard.tsx:1086 throws the generic Content Project error.`
- `FAILURE_CALL_CHAIN`: `submitGeminiCommand → structured GEMINI_CONVERSATION_RESET_DURING_SEND → runGeminiJsonCommand/finalizer preserves primary → Electron IPC rejection → desktopGemini.developProject → createContentProject catch reports then returns null → runAutomaticPipeline generic null-project throw → updateAutomationRun persists generic error.`
- `RELEVANT_EVIDENCE`: `browser-actions.ndjson command 875df4a0-32e8-41d9-ba0e-bcc5361d2db2 sequence 22 persisted primaryErrorCode=GEMINI_CONVERSATION_RESET_DURING_SEND with expected/actual URL, recoveryAttempt=1, recoveryBudget=1, turn deltas 0/0, generationRequestObserved=false, composerCleared=true, cookieRotationObserved=true; sequence 27 recorded secondary GEMINI_CONVERSATION_URL_MISMATCH with primaryFailurePreserved=true. The read-only /api/v1/automations response for the same run reported status FAILED, attemptCount=3, projectId=null, lease=null, but error=Không tạo được Content Project và phân cảnh.`
- `RECOMMENDED_REPAIR`: `Preserve and rethrow the caught Error from createContentProject after reporting/troubleshooting, or return a typed failure that the pipeline uses verbatim. Ensure stage status, AutomationRun.error, runtime incident message/code/context, and UI retain GEMINI_CONVERSATION_RESET_DURING_SEND. Add renderer/pipeline regression tests for primary-error preservation and keep the existing Electron/finalizer behavior unchanged.`
- `CHOSEN_REPAIR`: `Propagate structured upstream failures across the renderer/IPC/service boundary with an explicit {ok,data|error} DTO, revive the structured error in preload, rethrow the original failure from createContentProject after reporting, and reserve the null/generic Content Project fallback for a genuine no-cause empty result. Preserve code, message, firstDivergence, cause, expected/actual URLs, recovery counters, turn deltas, generation evidence, and safe diagnostic context. No cookie-rotation recovery behavior was changed.`
- `FILES_CHANGED`: `electron/gemini-error-transport.cjs; electron/main.cjs; electron/preload.cjs; electron/gemini-browser-lifecycle.cjs; src/components/viral-dashboard.tsx; package.json; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `Structured error transport round-trip test with secret redaction; IPC DTO and preload invocation contract test; renderer createContentProject rethrow and generic-fallback scope contract test; ISSUE-003 lifecycle assertions updated with firstDivergence/cause fields.`
- `TEST_RESULTS`: `Targeted Vitest PASS: 5 files, 115 tests (viral-dashboard.ui, gemini-conversation-lifecycle, edge-gemini-cdp, gemini-send-contract, gemini-browser-lifecycle). Typecheck PASS: npm run typecheck. Syntax PASS: node --check electron/main.cjs, electron/preload.cjs, electron/gemini-error-transport.cjs, electron/gemini-browser-lifecycle.cjs. git diff --check PASS.`
- `LIVE_VALIDATION`: `Focused synthetic boundary validation PASS: a GEMINI_CONVERSATION_RESET_DURING_SEND Error with structured context serialized at the transport boundary, revived in preload, and remained the same primary code/details; the renderer contract rethrows it and the generic Content Project error is not selected. No production run was resumed and no real Gemini generation was executed by this repair.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; attemptCount=3; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null; executionLease=null.`
- `NOTES`: `This is not a regression of the ISSUE-003 Electron repair: the structured reset error remains primary through command and finalizer, and is now transported across IPC and rethrown through renderer Stage 2 so the pipeline can persist it. No retry, new run, production resume, DB mutation, database reset, destructive cleanup, historical-run mutation, or runtime-data deletion was performed by this repair. Runtime data under C:\\Users\\Admin\\AppData\\Roaming\\ai-content-modeling, database state, and .env were not modified. Next action is WAIT_FOR_USER_CONTINUE_COMMAND.`

### ISSUE-005

- `ISSUE_ID`: `ISSUE-005`
- `FOLLOW_UP_OF`: `ISSUE-004`
- `DISCOVERED_AT`: `2026-09-19T17:19:48.813Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `4`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / CONTENT_PROJECT_DEVELOP`
- `FIRST_DIVERGENCE`: `PATCHED_WORKTREE_NOT_SERVING_RENDERER_SOURCE`, before the Stage-2 Gemini request could reach the repaired renderer/IPC boundary.
- `SYMPTOM`: `CONTINUE` started the same run, but Stage 2 failed immediately. The UI showed `Không tạo được Content Project và phân cảnh.` and a new troubleshooting incident; the AutomationRun remained FAILED with a generic error instead of the structured Gemini error expected after ISSUE-004.
- `LAST_CONFIRMED_GOOD_STATE`: `Before CONTINUE, ISSUE-004 was FIXED, targeted tests/typecheck/syntax/diff checks were PASS, the run checkpoint was lastCompletedStage=1 with resumeTarget=CONTENT_PROJECT_CREATION and executionLease=null, and the Electron main process was restarted from the recovery worktree.
- `EXPECTED_STATE`: `The renderer/API server used by the restarted Electron process must serve the same patched worktree source, so createContentProject rethrows the structured Stage-2 failure and the pipeline preserves its primary code/context.`
- `ACTUAL_STATE`: `The restarted Electron process was launched from C:\\Users\\Admin\\Desktop\\ytuongnoidung-github-recovery-20260919-142318, but DESKTOP_APP_URL was http://127.0.0.1:3210. Port 3210 was owned by the installed C:\\Users\\Admin\\AppData\\Local\\Programs\\Modeling AI\\Modeling AI.exe process serving resources\\app.asar.unpacked\\electron\\dist\\app\\server.js, not by a Next server from the patched recovery worktree. The live renderer therefore used the stale bundle whose createContentProject path still returned null and produced the generic fallback.`
- `ROOT_CAUSE`: `The Electron main/preload source and the renderer/API server were from different deployments. The patched worktree was loaded for Electron, while port 3210 served the installed/stale renderer, so ISSUE-004's renderer rethrow repair was not present in the live page.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Stale renderer bundle served by the installed Modeling AI server on port 3210: createContentProject consumes the Stage-2 failure and returns null; runAutomaticPipeline then emits the generic Content Project error.`
- `FAILURE_CALL_CHAIN`: `recovery-worktree electron/main.cjs → DESKTOP_APP_URL=http://127.0.0.1:3210 → installed Modeling AI.exe server → stale renderer createContentProject catch → null result → runAutomaticPipeline generic error → AutomationRun FAILED.`
- `RELEVANT_EVIDENCE`: `Get-NetTCPConnection showed 127.0.0.1:3210 owned by PID 5880. Win32_Process identified PID 5880 as C:\\Users\\Admin\\AppData\\Local\\Programs\\Modeling AI\\Modeling AI.exe with server.js under resources\\app.asar.unpacked. The recovery Electron main process was PID 7856 from the recovery worktree. Authenticated read-only run API after CONTINUE showed attemptCount=4, Stage 2 started at 2026-09-19T17:19:48.755Z and failed at 2026-09-19T17:19:48.807Z, error=Không tạo được Content Project và phân cảnh., projectId=null, executionLease=null. The page displayed a new incident beginning 0cae04af-347. No Gemini response wait or production retry occurred after this failure.`
- `RECOMMENDED_REPAIR`: `Serve the recovery worktree renderer/API from a dedicated local port (or rebuild/install the exact patched release), launch Electron with DESKTOP_APP_URL pointing to that matching server, and verify the renderer/preload/main revision alignment before another CONTINUE. Then run one focused non-production structured-error boundary check. Do not alter cookie-rotation recovery or create a new run.`
- `CHOSEN_REPAIR`: `Stopped the stale installed server on port 3210, made dev:local the canonical same-worktree launcher, started the renderer through the repository's npm run dev command on port 3210, launched Electron from this recovery worktree, and added a development runtime identity handshake. Electron now fails fast with RENDERER_SOURCE_MISMATCH or DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME before opening an unknown renderer. Structured-error revival remains sandbox-compatible.`
- `FILES_CHANGED`: `scripts/recovery-desktop-runtime.mjs; scripts/recovery-desktop-runtime.test.ts; electron/dev-runtime-identity.cjs; electron/dev-runtime-identity.test.ts; electron/main.cjs; electron/preload.cjs; src/app/api/runtime-identity/route.ts; package.json; docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `Development identity match/mismatch/empty-payload tests; same-worktree launcher and canonical npm run dev contract tests; port-ownership and startup identity guard contracts; existing ISSUE-004 structured-error propagation regression coverage.`
- `TEST_RESULTS`: `Targeted Vitest PASS: 7 files, 121 tests (dev-runtime-identity, recovery-desktop-runtime, edge-gemini-cdp, gemini-browser-lifecycle, gemini-conversation-lifecycle, gemini-send-contract, viral-dashboard UI). Typecheck PASS: npm run typecheck. Syntax PASS: dev-runtime-identity.cjs, main.cjs, preload.cjs, recovery-desktop-runtime.mjs. git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS using npm run dev:local. OLD_INSTALLED_APP_RUNNING=NO. Port 3210 was owned by PID 18940, the Next start-server process launched from C:\\Users\\Admin\\Desktop\\ytuongnoidung-github-recovery-20260919-142318; the parent Next command also used that worktree. Electron main PID 18516 used the same worktree and CDP port 53591. GET /api/runtime-identity returned app=ai-content-modeling, mode=development, sourceRootId=worktree-5d1b21ddaf281c20, sourceCommit=cbd3371fef0453db612729d21feef0769109aec7, runtimeRevision=worktree-dev; Electron opened http://127.0.0.1:3210/ and exposed the patched desktopGemini.developProject IPC function. The focused runtime was closed after validation. No production resume or Gemini generation was performed.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; attemptCount=4; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null; executionLease=null.`
- `NOTES`: `The original deployment mismatch is repaired and guarded. The launcher reads only existing desktop-config.json keys needed by the runtime; it does not reset/delete AppData, database contents, browser profiles, or .env. The production run was not resumed by this repair. Actual current state remains attempt 5 FAILED with lastCompletedStage=1, failedStage=2, resumeTarget=CONTENT_PROJECT_CREATION, contentProjectId=null, executionLease=null because ISSUE-006 is now the active Gemini cookie/auth failure. Therefore ISSUE-005 itself is FIXED, but the global run is not ready until ISSUE-006 is repaired.`

### ISSUE-006

- `ISSUE_ID`: `ISSUE-006`
- `REGRESSION_OF`: `ISSUE-002` (linked recurrence of the external Gemini cookie/navigation reset; strict failure propagation remains working)
- `FOLLOW_UP_OF`: `ISSUE-005`
- `DISCOVERED_AT`: `2026-09-19T23:51:09.363Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `5`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / CONTENT_PROJECT_DEVELOP`
- `FIRST_DIVERGENCE`: `GEMINI_CONVERSATION_RESET_DURING_SEND`
- `SYMPTOM`: `The canonical managed Edge profile was opened and Gemini showed a usable composer without login, account chooser, or CAPTCHA UI. The Stage-2 target ID 27f9c19a43da8886 is absent from the visible/current Gemini history. Direct opening of that target succeeded momentarily, then reset to generic /app. A different conversation opened from the normal history UI remained stable for 14 seconds. No prompt was sent.`
- `LAST_CONFIRMED_GOOD_STATE`: `Canonical Edge is open from C:\Users\Admin\AppData\Local\ModelingAI\EdgeGeminiProfile, Default profile, CDP 9333. Gemini history is visible and exposes exact conversation links. The other history conversation /app/280d4b6fd5590bf8 remained stable for the full observation; executionLease is null.`
- `EXPECTED_STATE`: `The canonical managed Edge instance uses C:\Users\Admin\AppData\Local\ModelingAI\EdgeGeminiProfile, active profile Default, CDP port 9333, remains authenticated to the expected Google account, stays on https://gemini.google.com/app/27f9c19a43da8886 during idle and Send, and creates an exact new user turn.`
- `ACTUAL_STATE`: `Live canonical Edge is running from the expected profile with one process root (PID 6428, normal child processes) and CDP 9333. Sidebar history contains many exact Gemini conversation links but none for /app/27f9c19a43da8886. The first valid history link /app/280d4b6fd5590bf8 was opened through its UI anchor and stayed on that exact URL for all 14 seconds of observation, with no login/chooser/CAPTCHA/RotateCookiesPage. The target direct URL still falls back to /app. No prompt was sent.`
- `GEMINI_BROWSER_PID`: `6428 process root; normal Edge child processes are present.`
- `GEMINI_CDP_PORT`: `9333.`
- `GEMINI_USER_DATA_DIR`: `C:\Users\Admin\AppData\Local\ModelingAI\EdgeGeminiProfile`.
- `GEMINI_PROFILE_DIRECTORY`: `Default` (Local State lastActiveProfiles and info_cache each contain only Default).
- `GEMINI_TARGET_URL`: `Current validated history conversation=https://gemini.google.com/app/280d4b6fd5590bf8; target under investigation=https://gemini.google.com/app/27f9c19a43da8886.`
- `GEMINI_LOGGED_IN`: `YES by live UI; Google account control showed Quang Tùng Ultra (email redacted).`
- `GOOGLE_ACCOUNT_VISIBLE`: `YES; display name only, email redacted.`
- `ACCOUNT_CHOOSER_VISIBLE`: `NO`
- `LOGIN_REQUIRED`: `NO`
- `SESSION_EXPIRED_UI`: `NO visible session-expired state.`
- `CAPTCHA_OR_HUMAN_VERIFY`: `NO`
- `PROFILE_CONCURRENT_OWNERS`: `[] currently.`
- `PROFILE_COLLISION`: `NO; no independent process uses the canonical profile. Normal Edge and Chrome groups use different default browser roots.`
- `IDLE_CONVERSATION_STABLE`: `NO for the target; YES for the history-opened other conversation.`
- `IDLE_ROTATE_COOKIES_OBSERVED`: `NO during the 14-second history-open observation; historical Send attempts still show RotateCookiesPage.`
- `COOKIE_ROTATION_TRIGGER`: `AFTER_SEND for the failed production attempts; the reset followed Send/ACTUAL_RESEND within seconds. Idle trigger is not evidenced.`
- `GEMINI_BROWSER_LAUNCHERS`: `Historical electron/main.cjs → EdgeGeminiRuntime, executable C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe, --user-data-dir canonical profile, --remote-debugging-port=9333. No current launcher process is active.`
- `MULTIPLE_AUTOMATION_OWNERS`: `NO for the canonical profile; only the managed Edge root is active. The installed Modeling AI and current worktree Electron are not controlling this browser.`
- `TARGET_CONVERSATION_VISIBLE_IN_HISTORY`: `NO; exact ID 27f9c19a43da8886 was absent from all visible/current Gemini history links.`
- `TARGET_OPENED_FROM_HISTORY`: `NO; no history link for the target existed.`
- `TARGET_STABLE_FROM_HISTORY`: `NO / NOT_APPLICABLE; target was unavailable from history.`
- `OTHER_CONVERSATION_OPENED`: `YES; opened normal history link https://gemini.google.com/app/280d4b6fd5590bf8.`
- `OTHER_CONVERSATION_STABLE`: `YES; exact URL remained stable for 14 seconds.`
- `NEW_CHAT_HOME_STABLE`: `NOT_RUN; history comparison already distinguished the issue.`
- `ROOT_CAUSE`: `The persisted Stage-2 conversation ID 27f9c19a43da8886 is stale, deleted, or inaccessible under the currently active Google account: it is not represented by any visible/current history link and direct navigation falls back to /app. A different existing conversation opened through the normal Gemini UI remains stable, so the route/session is not globally unstable. The evidence does not support a profile collision or global auth failure.`
- `ROOT_CAUSE_CLASS`: `A — STALE_OR_DELETED_TARGET_CONVERSATION`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs submitGeminiCommand / Gemini browser lifecycle reset classification; propagated through desktopGemini.developProject → createContentProject → runAutomaticPipeline → AutomationRun settlement.`
- `FAILURE_CALL_CHAIN`: `CONTINUE same run → recovery-worktree renderer alignment PASS → resume checkpoint Stage 2 → canonical managed Edge profile opened → Send/ACTUAL_RESEND → accounts.google.com/RotateCookiesPage and route reset to /app → GEMINI_CONVERSATION_RESET_DURING_SEND → structured failure persistence.`
- `RELEVANT_EVIDENCE`: `Live process inventory shows the canonical Edge root PID 6428 with --remote-debugging-port=9333 and the exact canonical --user-data-dir. Home/sidebar inspection found many exact gemini.google.com/app/<id> links but no /app/27f9c19a43da8886 link. The account control displayed Quang Tùng Ultra with email redacted. Corrected normal-UI click opened /app/280d4b6fd5590bf8; eight samples over 14 seconds all remained on that exact URL with no login/chooser/CAPTCHA/RotateCookiesPage. Target direct navigation previously reset to /app after approximately 2 seconds. Historical send attempts still show RotateCookiesPage and zero turn deltas.`
- `RECOMMENDED_REPAIR`: `Stop depending on the stale hardcoded conversation ID. Through the canonical Gemini UI, resolve or create a valid dedicated conversation, verify that its exact link remains stable when opened from history, then persist that current conversation ID for Stage 2. Do not change cookies/profile, increase retries, or resume production until the new ownership check passes.`
- `CHOSEN_REPAIR`: `None. This task was read-only investigation; user repair direction is required.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_STATE.json; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `None. Read-only investigation only.`
- `TEST_RESULTS`: `Read-only DOM/history inspection and normal UI navigation comparison PASS. No source code/database changes, cookie deletion, logout, or prompt send was performed; the existing canonical browser remained open.`
- `LIVE_AUTH_CHECK`: `PASS for account/history comparison; FAIL for target ownership. Canonical browser/profile opened, account display name was visible, target ID was absent from history, and a different history conversation remained stable for 14 seconds. No prompt was sent.`
- `GEMINI_LOGGED_IN`: `YES; account display name visible, email redacted.`
- `EXPECTED_ACCOUNT_ACTIVE`: `UNKNOWN; no non-secret expected-account identifier was provided for comparison.`
- `LOGIN_REQUIRED`: `NO`
- `HUMAN_AUTH_ACTION_REQUIRED`: `NO visible challenge at time of check`
- `IDLE_SESSION_STABLE`: `NO for target; YES for another history conversation.`
- `COOKIE_ROTATION_OBSERVED`: `NO during history-open validation; YES historically during Attempts 3–5 Send.`
- `NEW_USER_TURN_CONFIRMED`: `NOT_RUN`
- `GENERATION_REQUEST_OBSERVED`: `NOT_RUN`
- `ASSISTANT_RESPONSE_RECEIVED`: `NOT_RUN`
- `GEMINI_SESSION_SEND_STABLE`: `NOT_RUN — ownership/accessibility failed before safe diagnostic Send.`
- `LIVE_VALIDATION`: `PASS for normal history conversation stability; target ownership validation classified A. No production run was resumed and no prompt was sent.`
- `STATUS`: `OPEN`
- `RESUME_CHECKPOINT`: `lastCompletedStage=1; failedStage=2; resumeTarget=CONTENT_PROJECT_CREATION; attemptCount=5; modelingIdeaId=cmu8aogti004ck5jcd4rp2f4m; contentProjectId=null; executionLease=null.`
- `NOTES`: `ISSUE-005 is not regressed: the canonical browser was reused directly and no installed Modeling AI runtime was launched. The mistaken first selector matched the Google account link because its continue parameter contained /app/27f9c19a43da8886; it did not log out or change account. The corrected selector used exact Gemini hostname/path and opened a real history conversation successfully. Next action is WAIT_FOR_USER_REPAIR_COMMAND.`
- `REPAIR_ATTEMPT_AT`: `2026-09-21T06:15:48.000Z`
- `CHOSEN_REPAIR`: `Validate the saved conversation before use; when stale, mark it DELETED for runtime purposes, open New Chat through the exact Gemini UI control, allow a null pre-send conversation ID, and persist only the exact /app/<new-id> observed after a confirmed user turn.`
- `FILES_CHANGED`: `electron/gemini-conversation-lifecycle.cjs; electron/gemini-conversation-lifecycle.test.ts; electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Stale bare-app classification; stale binding invalidation; New Chat-only selection; no unconfirmed bare-app persistence; no arbitrary history fallback.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 109 tests; typecheck PASS; node --check main.cjs and gemini-conversation-lifecycle.cjs PASS; git diff --check PASS.`
- `STALE_CONVERSATION_DETECTED`: `YES — 27f9c19a43da8886 redirected to bare /app.`
- `NEW_CHAT_READY`: `YES — canonical Edge profile, normal Gemini UI, bare /app with usable composer, no visible auth challenge.`
- `NEW_USER_TURN_CONFIRMED`: `NO — diagnostic prompt did not appear as a new user turn.`
- `GENERATION_REQUEST_OBSERVED`: `NO — no generation started.`
- `ASSISTANT_RESPONSE_RECEIVED`: `NO.`
- `NEW_GEMINI_CONVERSATION_ID`: `null — no exact /app/<id> was produced.`
- `NEW_CONVERSATION_URL_STABLE`: `NO — URL remained bare /app.`
- `CANONICAL_CONVERSATION_ID_PERSISTED`: `NO — invalid/unconfirmed replacement was not written.`
- `PERSISTED_CONVERSATION_REOPENS`: `NOT_RUN — no replacement ID existed.`
- `PERSISTED_CONVERSATION_STABLE`: `NOT_RUN — no replacement ID existed.`
- `ARBITRARY_HISTORY_FALLBACK_USED`: `NO.`
- `LIVE_VALIDATION`: `FAIL — after opening New Chat and composing GEMINI_CONVERSATION_READY with native input state, one official Gửi tin nhắn click cleared/left the composer on bare /app but produced no new user turn, no assistant response, no generation evidence, and no conversation ID.`
- `FOLLOW_UP_LIVE_VALIDATION`: `PASS — same existing run, attempt 11, automatically marked the stale binding DELETED, opened New Chat through Gemini UI, submitted the real Stage-2 prompt, confirmed the exact new user turn, observed generation and a non-empty JSON response, persisted app-owned conversation b481d37db332cf6a, and created ContentProject cmuagw9cx0001k5806rv7o518 with 4 scenes. No arbitrary history conversation was selected.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Production run is PAUSED after Stage 2; lastCompletedStage=2; failedStage=null; resumeTarget=null; attemptCount=11; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518.`
- `NOTES`: `The earlier diagnostic replacement attempt failed closed and did not persist an invalid ID. The subsequent same-run validation completed the app-owned replacement path successfully. The stale ID was not reused; the confirmed new ID is now persisted in the run checkpoint. No production data reset, cookie/profile deletion, logout, arbitrary history fallback, or new AutomationRun was performed.`

### ISSUE-007

- `ISSUE_ID`: `ISSUE-007`
- `DISCOVERED_AT`: `2026-09-21T06:39:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `9`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / ContentProject.create`
- `FIRST_DIVERGENCE`: `SQLITE_STALE_CONTENT_PROJECT_FOREIGN_KEYS`
- `SYMPTOM`: `Stage 2 received valid Gemini JSON but ContentProject.create failed because main.ContentProject__release_old did not exist.`
- `LAST_CONFIRMED_GOOD_STATE`: `Gemini prompt submission, generation, response completion, JSON parsing, and validation all passed; the failure occurred at the first database write.`
- `EXPECTED_STATE`: `ContentProject and all dependent tables reference the live ContentProject table after SQLite release-schema reconciliation.`
- `ACTUAL_STATE`: `Asset, ProjectReview, StoryboardScene, and UsageEvent foreign keys referenced the temporary ContentProject__release_old name left by the sourceDuration REAL rebuild.`
- `ROOT_CAUSE`: `The SQLite compatibility rebuild used legacy_alter_table and repaired CompetitorVideo dependants but omitted the four ContentProject dependants, leaving stale foreign-key targets.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Prisma contentProject.create() at the Stage-2 API persistence boundary.`
- `FAILURE_CALL_CHAIN`: `Gemini response → renderer/API ContentProject creation → Prisma INSERT → SQLite foreign-key target ContentProject__release_old missing.`
- `RELEVANT_EVIDENCE`: `Read-only sqlite_master inspection showed all four dependent table definitions referenced ContentProject__release_old; PRAGMA foreign_key_check was empty because the target table was absent but no dependent rows existed yet. A targeted backup of modeling-ai.db was created before the idempotent repair.`
- `RECOMMENDED_REPAIR`: `Extend the existing idempotent stale-foreign-key repair map to rebuild only the affected dependent tables with references changed to ContentProject, preserving rows and indexes.`
- `CHOSEN_REPAIR`: `Added Asset, ProjectReview, StoryboardScene, and UsageEvent mappings to repairStaleForeignKeys; applied ensureSqliteReleaseSchema once to the canonical DB. No reset, drop, truncate, seed, or destructive migration was run.`
- `FILES_CHANGED`: `electron/sqlite-release-schema.cjs; electron/sqlite-release-schema.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `ContentProject dependant stale-FK repair test with row-preservation assertion.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 20 tests; typecheck PASS; node syntax checks PASS; git diff --check PASS; canonical DB repair reported all four dependent tables repaired and sourceDuration types REAL.`
- `LIVE_VALIDATION`: `PASS — subsequent Stage 2 run reached ContentProject persistence without the missing ContentProject__release_old error.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Attempt 9 failed at Stage 2 before project creation; later attempt 11 completed Stage 2.`
- `NOTES`: `Database contents were preserved. A backup copy was created at modeling-ai.db.before-issue-007-20260921.bak. Runtime AppData and browser profile were not deleted or reset.`

### ISSUE-008

- `ISSUE_ID`: `ISSUE-008`
- `DISCOVERED_AT`: `2026-09-21T06:43:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `10`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / Gemini preflight`
- `FIRST_DIVERGENCE`: `DUPLICATE_GEMINI_CONVERSATION_PREFLIGHT`
- `SYMPTOM`: `A valid persisted conversation was preflighted successfully, then the send preparation immediately started a second full identity-stabilization window and surfaced GEMINI_CONVERSATION_URL_MISMATCH without sending.`
- `LAST_CONFIRMED_GOOD_STATE`: `The first preflight recorded the exact persisted conversation URL and a PASS identity result.`
- `EXPECTED_STATE`: `One successful preflight is sufficient to authorize the following send operation.`
- `ACTUAL_STATE`: `prepareGeminiConversationForCommand called preflightGeminiForRun and then called waitForGeminiConversationIdentity again, duplicating the bounded validation.`
- `ROOT_CAUSE`: `The send path repeated an already-completed preflight instead of reusing its validated binding.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs prepareGeminiConversationForCommand / waitForGeminiConversationIdentity.`
- `FAILURE_CALL_CHAIN`: `Stage 2 resume → preflight PASS → duplicate identity wait → false GEMINI_CONVERSATION_URL_MISMATCH → finalizer.`
- `RELEVANT_EVIDENCE`: `Attempt 10 browser-actions showed first reopen identity PASS at 3000 ms, then no command send and a second identity wait ending FAIL with the same final URL. The run settled FAILED with lease null.`
- `RECOMMENDED_REPAIR`: `Reuse the preflight-validated binding and do not start another full stabilization window immediately before send.`
- `CHOSEN_REPAIR`: `prepareGeminiConversationForCommand now returns the binding after preflight; the stale-conversation and ownership checks remain in preflight.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Source-contract assertion that send preparation reuses the validated binding and does not call the identity wait a second time.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 20 tests; typecheck PASS; syntax and diff checks PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 11 sent and completed the Content Project prompt.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Attempt 10 failed at Stage 2; later attempt 11 completed Stage 2.`
- `NOTES`: `No retry budget or timeout was expanded.`

### ISSUE-009

- `ISSUE_ID`: `ISSUE-009`
- `DISCOVERED_AT`: `2026-09-21T06:45:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `10`
- `STAGE`: `2 — Content Project và phân cảnh`
- `JOB/SCENE`: `automatic-pipeline / content-project-creation / Gemini identity stabilization`
- `FIRST_DIVERGENCE`: `STABILIZATION_WINDOW_BOUNDARY_FALSE_MISMATCH`
- `SYMPTOM`: `The last valid conversation observation was correct, but the final polling delay crossed the 3000 ms boundary and the function fell through to GEMINI_CONVERSATION_URL_MISMATCH.`
- `LAST_CONFIRMED_GOOD_STATE`: `The last observed URL matched the persisted conversation ID and assertConversationReady had already succeeded.`
- `EXPECTED_STATE`: `A final verified observation at the stabilization boundary is a PASS.`
- `ACTUAL_STATE`: `The loop condition was checked before the final delay; after that delay the function emitted the generic mismatch without considering verifiedBinding.`
- `ROOT_CAUSE`: `Polling boundary logic discarded the last successful identity observation when elapsed time crossed the threshold between iterations.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs waitForGeminiConversationIdentity final fallback.`
- `FAILURE_CALL_CHAIN`: `Gemini conversation reopen → valid identity observation → final poll delay → stabilization loop exit → false URL mismatch.`
- `RELEVANT_EVIDENCE`: `Attempt 10 event duration was approximately 3096 ms with finalObservedUrl equal to the persisted URL and result FAIL. The finalizer also observed the same exact URL.`
- `RECOMMENDED_REPAIR`: `If verifiedBinding exists and the last observed URL still matches the owned conversation, return PASS after the loop instead of manufacturing a mismatch.`
- `CHOSEN_REPAIR`: `Added the FINAL_VERIFIED_OBSERVATION pass path and regression assertion.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Stabilization-boundary source-contract assertion.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 20 tests; typecheck PASS; syntax and diff checks PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 11 completed the real Stage-2 send, Gemini response, and project persistence.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Attempt 10 failed at Stage 2; later attempt 11 completed Stage 2.`
- `NOTES`: `The patch remains fail-closed for bare /app and mismatched IDs.`

### ISSUE-010

- `ISSUE_ID`: `ISSUE-010`
- `DISCOVERED_AT`: `2026-09-21T06:46:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `11`
- `STAGE`: `runtime startup`
- `JOB/SCENE`: `development Electron/CDP startup`
- `FIRST_DIVERGENCE`: `STALE_DEVTOOLS_PORT_LISTENER`
- `SYMPTOM`: `A prior same-worktree Electron instance left CDP port 53591 reported as listening but unresponsive, so a fresh runtime could not bind that port.`
- `LAST_CONFIRMED_GOOD_STATE`: `Renderer port 3210 and source identity were healthy.`
- `EXPECTED_STATE`: `The current development runtime binds a responsive CDP port.`
- `ACTUAL_STATE`: `The old CDP listener was unresponsive and prevented startup on the canonical development CDP port.`
- `ROOT_CAUSE`: `Stale Electron process/socket state from the previous development runtime.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Electron Chromium DevTools HTTP handler during startup.`
- `FAILURE_CALL_CHAIN`: `npm run dev:local → Electron startup → CDP bind failure.`
- `RELEVANT_EVIDENCE`: `Electron logged bind() returned an error for 53591. Targeted process inspection found the same recovery-worktree Electron group; it was stopped by exact executable path. The runtime was then launched on 53592 and completed Stage 2.`
- `RECOMMENDED_REPAIR`: `Stop only stale same-worktree Electron processes before retrying, or use a free development CDP port; never kill installed production runtime or touch AppData.`
- `CHOSEN_REPAIR`: `Stopped only recovery-worktree Electron processes and launched the same-worktree development runtime on free CDP port 53592. No installed app, Edge profile, database, or runtime AppData was removed.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None; operational startup recovery.`
- `TEST_RESULTS`: `PASS — renderer identity and Electron runtime started on the recovery worktree; Stage 2 completed.`
- `LIVE_VALIDATION`: `PASS — runtime source identity matched and the same run completed Stage 2.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Attempt 11 completed Stage 2; run status PAUSED; executionLease=null.`
- `NOTES`: `The unresponsive CDP listener was not a production-data issue. The installed app was not uninstalled or modified.`

### ISSUE-011

- `ISSUE_ID`: `ISSUE-011`
- `DISCOVERED_AT`: `2026-09-21T06:56:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `11`
- `STAGE`: `2 — post-success run persistence`
- `JOB/SCENE`: `automatic-pipeline / Stage-2 success checkpoint`
- `FIRST_DIVERGENCE`: `STALE_SUCCESS_ERROR_METADATA`
- `SYMPTOM`: `Stage 2 was complete with status PAUSED, failedStage=null, a completed content-project step, and a valid project, but AutomationRun.error and failureFingerprint still contained the previous failed-attempt metadata.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 2 attempt 11 completed and created ContentProject cmuagw9cx0001k5806rv7o518 with 4 scenes.`
- `EXPECTED_STATE`: `A successful Stage-2 checkpoint clears prior error and failureFingerprint metadata while preserving the run checkpoint.`
- `ACTUAL_STATE`: `The Stage-2 success update omitted error:null and failureFingerprint:null, so old failure metadata survived the successful checkpoint.`
- `ROOT_CAUSE`: `The Stage-2 success persistence path did not explicitly clear historical failure fields.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/components/viral-dashboard.tsx Stage-2 success checkpoint update.`
- `FAILURE_CALL_CHAIN`: `Earlier Stage-2 failure metadata → successful Stage-2 persistence → omitted clear fields → stale error remained visible in run state.`
- `RELEVANT_EVIDENCE`: `The normal PATCH response showed status=PAUSED, lastCompletedStage=2, failedStage=null, projectId=cmuagw9cx0001k5806rv7o518, but error and failureFingerprint still held the prior failure. A normal app API PATCH cleared both fields without changing stage, project, data, or lease.`
- `RECOMMENDED_REPAIR`: `Clear error and failureFingerprint in both Stage-2 success writes, including the checkpoint payload.`
- `CHOSEN_REPAIR`: `Added error:null and failureFingerprint:null to the Stage-2 success and validation-stop persistence paths; cleared the current run's stale fields through the existing application PATCH boundary.`
- `FILES_CHANGED`: `src/components/viral-dashboard.tsx; src/components/viral-dashboard.ui.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `UI source contract asserting both Stage-2 success writes clear error and failureFingerprint.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 40 tests; typecheck PASS; node --check main.cjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — current run returned status PAUSED, lastCompletedStage=2, failedStage=null, error=null, failureFingerprint=null, executionLease=null; existing ContentProject and 4 scenes preserved.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Run remains PAUSED after Stage 2; explicit continuation is required for Stage 3.`
- `NOTES`: `No Stage 2 rerun, new run, database reset, project deletion, or runtime-data cleanup was performed.`

### ISSUE-012

- `ISSUE_ID`: `ISSUE-012`
- `DISCOVERED_AT`: `2026-09-21T07:05:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `12`
- `STAGE`: `runtime startup`
- `JOB/SCENE`: `development Next/Electron runtime`
- `FIRST_DIVERGENCE`: `DEV_NEXT_BUILD_CACHE_COLLISION`
- `SYMPTOM`: `The renderer returned Next Internal Server Error/missing chunks after a production build ran while the same-worktree Next dev server was active.`
- `LAST_CONFIRMED_GOOD_STATE`: `The recovery-worktree renderer and Electron identity guard were healthy before the concurrent build.`
- `EXPECTED_STATE`: `One current-worktree development renderer serves port 3210 from a coherent .next development cache.`
- `ACTUAL_STATE`: `The build rewrote the active dev cache, so the running dev process referenced missing or mismatched chunks.`
- `ROOT_CAUSE`: `Development and production build artifacts were used concurrently in the same Next worktree cache.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Next dev renderer while serving the run page.`
- `FAILURE_CALL_CHAIN`: `npm run build during active npm run dev:local → .next cache replacement → renderer chunk/route errors.`
- `RELEVANT_EVIDENCE`: `Stopping the old same-worktree dev runtime and restarting npm run dev:local from the recovery worktree restored the page and runtime identity. No installed app, AppData, browser profile, or database was modified.`
- `RECOMMENDED_REPAIR`: `Do not run build concurrently with the active dev server; restart the same-worktree dev runtime after any artifact-changing build.`
- `CHOSEN_REPAIR`: `Stopped the stale development runtime and restarted the current recovery-worktree runtime on CDP 53592.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None; operational runtime recovery.`
- `TEST_RESULTS`: `PASS — renderer identity endpoint, port 3210, and Electron CDP 53592 became responsive.`
- `LIVE_VALIDATION`: `PASS — the current worktree runtime served the Stage-3 page and resumed the existing run.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Run reached Stage 3 after runtime restart; no production data was changed by this incident.`
- `NOTES`: `Future build validation must stop the active dev server first, then restart it from the same worktree.`

### ISSUE-013

- `ISSUE_ID`: `ISSUE-013`
- `DISCOVERED_AT`: `2026-09-21T07:12:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `12`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / prompt-fidelity preparation / background + scenes 2–4`
- `FIRST_DIVERGENCE`: `PROMPT_FIDELITY_GATE_BEFORE_FLOW_IMAGE_JOB`
- `SYMPTOM`: `Stage 3 ended with no image assets and the generic message Không tạo đủ ảnh bằng Google Flow before any Flow generation request was started.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 2 was complete with ContentProject cmuagw9cx0001k5806rv7o518 and four mapped scenes.`
- `EXPECTED_STATE`: `All five image slots pass Prompt Fidelity, then the real Google Flow image job starts.`
- `ACTUAL_STATE`: `The background slot failed PROMPT_CHARACTER_IDENTITY_LOCK; scene 2 failed PROMPT_CAMERA_MATCH because the authoritative Medium close-up line was treated as a conflict; scenes 3 and 4 failed PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION because approved scene-appearance/start-frame prose was scanned as new creative action. The image helper then swallowed the specific gate error and returned null.`
- `ROOT_CAUSE`: `Image slot construction omitted the identity lock from the background draft, while the Prompt Fidelity validator did not distinguish authoritative/approved contract lines from appended creative instructions. The Stage-3 image helper also converted the specific gate failure into a generic null result.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/modules/prompt-fidelity/service.ts gate validation; src/components/viral-dashboard.tsx generateAllProjectImages catch.`
- `FAILURE_CALL_CHAIN`: `Stage 3 resume → preparePromptForFlow for five slots → Prompt Fidelity 409 for background/scenes 2–4 → generateAllProjectImages catch → null → generic image-stage failure.`
- `RELEVANT_EVIDENCE`: `Runtime incident rows at 2026-09-21T00:11:59Z recorded the exact failed validators for scenes 2–4 and background. PromptFidelityTrace contained only scene 1, proving Flow was never reached. Asset count remained 0 and executionLease settled to null.`
- `RECOMMENDED_REPAIR`: `Make the background draft carry the same identity contract, exclude authoritative/approved contract lines from creative-addition/camera-conflict scanning, preserve appended-action rejection, and rethrow the specific image preparation failure.`
- `CHOSEN_REPAIR`: `Applied the narrow prompt-gate and error-propagation repair; targeted tests and typecheck pass. Live validation then confirmed all five prompts passed the gate; the remaining failure was recorded as ISSUE-014.`
- `FILES_CHANGED`: `src/modules/prompt-fidelity/validator.ts; src/modules/prompt-fidelity/validator.test.ts; src/components/viral-dashboard.tsx; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Authoritative Medium close-up contract is not rejected; approved scene-appearance dance prose is ignored while appended jump/dance is rejected.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 60 tests; typecheck PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS for Prompt Fidelity preparation — background and scenes 1–4 produced persisted PASS traces. Stage 3 then exposed the separate background trace scene-binding defect recorded as ISSUE-014.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=13; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No retry count, timeout, browser profile, cookie, database reset, or arbitrary conversation fallback was changed. Continue with the same run only after the current patched runtime is confirmed.`

### ISSUE-014

- `ISSUE_ID`: `ISSUE-014`
- `DISCOVERED_AT`: `2026-09-21T07:26:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `13`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / background image prompt verification`
- `FIRST_DIVERGENCE`: `BACKGROUND_PROMPT_TRACE_BOUND_TO_FIRST_SCENE`
- `SYMPTOM`: `All five image prompts passed Prompt Fidelity, but Flow rejected the first background slot as PROMPT_MUTATED_AFTER_VALIDATION before generation.`
- `LAST_CONFIRMED_GOOD_STATE`: `The background PromptFidelityTrace was persisted with sceneId=null and the renderer sent the exact validated prompt/hash.`
- `EXPECTED_STATE`: `Verification of a background trace with no sceneNumber must compare against sceneId=null.`
- `ACTUAL_STATE`: `verifyPersistedPromptByScene selected the first ContentProject scene even when sceneNumber was undefined, so the background trace null sceneId was compared with scene 1 and rejected.`
- `ROOT_CAUSE`: `Background verification used the first scene as a surrogate instead of preserving the intentional null scene binding.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/modules/prompt-fidelity/service.ts verifyPersistedPromptByScene; Electron validatedPromptForSend surfaced the server rejection.`
- `FAILURE_CALL_CHAIN`: `background prompt PASS → trace sceneId=null → Flow IPC verification with sceneNumber undefined → service selected first scene id → PROMPT_MUTATED_AFTER_VALIDATION → no Flow generation.`
- `RELEVANT_EVIDENCE`: `Attempt 13 run error was Error invoking remote method flow-browser:run-image-job: PROMPT_MUTATED_AFTER_VALIDATION: ảnh Bối cảnh đồng nhất server từ chối prompt trace. The latest trace row had sceneId=null; scene 2 and background traces otherwise showed validation PASS. Asset count remained 0 and executionLease settled null.`
- `RECOMMENDED_REPAIR`: `Keep sceneId=null when sceneNumber is undefined and add a regression test through verifyPersistedPromptByScene.`
- `CHOSEN_REPAIR`: `Changed verifyPersistedPromptByScene to use null for undefined sceneNumber; added a background trace binding test.`
- `FILES_CHANGED`: `src/modules/prompt-fidelity/service.ts; src/modules/prompt-fidelity/service.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Background prompt trace verification preserves null sceneId.`
- `TEST_RESULTS`: `PASS — targeted Vitest 3 files / 64 tests; typecheck PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 14 passed Prompt Fidelity and background trace verification; the run reached the real Google Flow image download boundary before failing with ISSUE-015.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=14; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No prompt mutation, retry expansion, browser/profile change, database reset, or asset deletion was performed.`

### ISSUE-015

- `ISSUE_ID`: `ISSUE-015`
- `DISCOVERED_AT`: `2026-09-21T07:33:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `14`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / Google Flow image download`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_ASSET_DOWNLOAD_VIA_EDGE_CDP`
- `SYMPTOM`: `Google Flow generated the image, but Stage 3 failed before saving any asset with: Google Flow không cho phép tải ảnh vừa tạo qua Edge/CDP.`
- `LAST_CONFIRMED_GOOD_STATE`: `All five Prompt Fidelity traces passed and Flow accepted the image-generation request.`
- `EXPECTED_STATE`: `The generated Flow image response is captured through the managed Edge/CDP bridge and saved to the project image store.`
- `ACTUAL_STATE`: `The page-context image fetch returned no usable bitmap; the Edge runtime image path had no CDP response-body fallback, so the generated image could not cross into the app.`
- `ROOT_CAUSE`: `The Flow image observer only accepted flow-content.google/image URLs, while the live Flow UI delivered generated image tiles as flow.google.com/asb URLs. That source was not classified as a generated output; the Edge/CDP download fallback therefore never received a stable accepted image source.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs inspectFlowImage/getFlowImageBuffer`
- `FAILURE_CALL_CHAIN`: `Flow generation → generated tile source flow.google.com/asb/... → observer accepted only flow-content.google/image/... → output was not stably identified/captured → bounded retry → getFlowImageBuffer throws → Stage 3 settles run FAILED.`
- `RELEVANT_EVIDENCE`: `Attempts 14–16 settled FAILED with asset count=0; read-only Edge/CDP inspection of the live Flow project showed the generated tile URL was flow.google.com/asb/... with aria-label Minimalist office background design, while the observer regex accepted only flow-content.google/image/... .`
- `RECOMMENDED_REPAIR`: `Use the existing managed CDP response-body capture as a bounded fallback for Flow images, preserving the page-context path first and retaining fail-closed validation of image bytes.`
- `CHOSEN_REPAIR`: `Accept the live Flow-generated flow.google.com/asb source alongside flow-content.google/image, then use page fetch followed by exact-URL CDP response capture with cache disabled and byte-size validation.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Static runtime contract asserting page fetch remains primary and CDP image response capture is the fallback.`
- `TEST_RESULTS`: `PASS — first repair tests passed; refined capture contract is pending re-run.`
- `LIVE_VALIDATION`: `PASS — attempt 23 generated and persisted all five Stage-3 images after the live Flow source-recognition and CDP capture repairs.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=14; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No database reset, browser-profile cleanup, cookie deletion, production-run replacement, or arbitrary retry was performed.`

### ISSUE-016

- `ISSUE_ID`: `ISSUE-016`
- `DISCOVERED_AT`: `2026-09-21T08:15:31+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `19`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / Google Flow image-mode configuration`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_MODE_CONTROL_NOT_FOUND`
- `SYMPTOM`: `Stage 3 stopped while configuring the first Flow image job with: Không tìm thấy chế độ image / ảnh trong cài đặt Google Flow.`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow project opened successfully and the settings trigger was visible.`
- `EXPECTED_STATE`: `The open Flow settings panel exposes the Mode toggle with Image selected or selectable.`
- `ACTUAL_STATE`: `The configuration path timed out while searching generic role=radio controls; a read-only DOM inspection showed the live control is flow-toggles[aria-label="Mode"] containing a mat-button-toggle radio, and the panel may require an explicit reopen after the settings trigger click.`
- `ROOT_CAUSE`: `The image-mode resolver relied on a generic radio search without a bounded settings-panel reopen/diagnostic path, so a transiently unopened Flow settings overlay was reported as a missing Image mode.`
- `ROOT_CAUSE_CONFIDENCE`: `PROVISIONAL`
- `ERROR_THROW_SITE`: `electron/main.cjs ensureFlowMode`
- `FAILURE_CALL_CHAIN`: `Flow project ready → configureFlowImage → settings trigger click → mode panel not observed by generic radio resolver → 15s timeout → flow-browser:run-image-job failure → Stage 3 settled FAILED.`
- `RELEVANT_EVIDENCE`: `Attempt 19 settled FAILED with asset count=0 and executionLease=null. The same live Flow page, inspected read-only after failure, exposed flow-toggles aria-label=Mode, Image radio aria-checked=true, Video radio aria-checked=false, and the settings trigger.`
- `RECOMMENDED_REPAIR`: `Make ensureFlowMode target the explicit Mode toggle, reopen the Settings trigger a bounded number of times when the panel is absent, and record observed mode labels before failing.`
- `CHOSEN_REPAIR`: `Explicitly target Flow's Mode toggle, boundedly reopen Settings when needed, and record observed mode labels before failing.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Flow image-mode control contract coverage and existing Flow download/Prompt Fidelity regression coverage.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 71 tests; typecheck PASS; node --check electron/main.cjs and scripts/recovery-desktop-runtime.mjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 23 reached image generation and persisted all five Stage-3 images.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=19; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No production data, cookies, browser profile, or database contents were deleted or reset.`

### ISSUE-017

- `ISSUE_ID`: `ISSUE-017`
- `REGRESSION_OF`: `ISSUE-015`
- `DISCOVERED_AT`: `2026-09-21T08:27:47+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `20`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / Google Flow image download after generation`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_SOURCE_NOT_READY_AT_CAPTURE`
- `SYMPTOM`: `Flow generated visible image tiles, but Stage 3 eventually failed with Google Flow không cho phép tải ảnh vừa tạo qua Edge/CDP. The candidate log recorded only flow-content.google/image sources; the live page later exposed flow.google.com/asb image URLs that were fetchable, but the capture path did not wait for that source transition.`
- `LAST_CONFIRMED_GOOD_STATE`: `Prompt Fidelity passed for all five slots; Flow project opened; image mode configuration passed; generated image tiles were visible in the managed Edge page.`
- `EXPECTED_STATE`: `After generation, capture waits for a stable downloadable generated-image source, including the live asb source, then validates image bytes and returns the asset.`
- `ACTUAL_STATE`: `getFlowImageBuffer took a single candidate snapshot. The first candidate was a flow-content URL that did not yield a valid image through page/CDP. The later asb URLs were present and returned HTTP 200 image/webp in read-only page inspection, but were not included in the candidate set for that capture attempt.`
- `ROOT_CAUSE`: `The image download fallback recognized the new asb URL format but sampled candidate sources only once, immediately after the observer saw an earlier flow-content source. Flow replaces or adds the usable asb tile source asynchronously, so the capture path exhausted its bounded read/CDP attempts against a stale source before re-observing the current DOM.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs getFlowImageBuffer`
- `FAILURE_CALL_CHAIN`: `Flow image generation → observer returns flow-content source → one-time candidate list → page fetch/CDP capture against stale source → usable asb tile appears later → capture throws → Stage 3 settles FAILED.`
- `RELEVANT_EVIDENCE`: `Attempt 20 settled FAILED with assetCount=0 and executionLease=null. browser-actions.ndjson recorded flow-image-download-candidates at 01:22:41 and 01:25:32 with count=1 and flow-content sources. After failure, read-only CDP inspection found two flow.google.com/asb sources; authenticated page fetch returned status 200, type image/webp, sizes 5692 and 5436 bytes.`
- `RECOMMENDED_REPAIR`: `Use a bounded candidate-observation loop for images: re-scan the live Flow DOM while generation output settles, include both source families, attempt each newly observed source through page-context fetch, and only then use the exact-source CDP fallback. Keep byte/mime validation and fail closed.`
- `CHOSEN_REPAIR`: `Added a bounded live candidate-observation loop. It re-scans the Flow DOM while output settles, tries each newly observed source through a single validated page-context fetch, then orders current DOM candidates before the exact-source CDP fallback.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Static contract coverage for the one-shot page fetch, candidate re-observation loop, asb/flow-content source handling, and current-candidate CDP fallback ordering.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 81 tests; typecheck PASS; node --check electron/main.cjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 23 delayed candidate observation until the live asb sources were available and persisted all five Stage-3 images.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=20; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No retry-count expansion, timeout increase for the pipeline, database reset, browser-profile cleanup, cookie deletion, or new run was performed.`

### ISSUE-018

- `ISSUE_ID`: `ISSUE-018`
- `REGRESSION_OF`: `ISSUE-017`
- `DISCOVERED_AT`: `2026-09-21T08:42:17+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `21`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / Google Flow image download after CDP reload`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_SOURCE_APPEARS_AFTER_CDP_RELOAD`
- `SYMPTOM`: `The bounded source-observation loop exhausted against a flow-content URL. The exact-source CDP fallback reloaded the Flow page, but the newly rendered asb image source was not re-observed or fetched before the handler threw the same download error.`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow generated a visible image tile and the image candidate observer recorded the flow-content URL.`
- `EXPECTED_STATE`: `If the CDP reload changes the generated tile to a usable asb source, the post-reload DOM is re-scanned and the image is fetched and validated before failing.`
- `ACTUAL_STATE`: `browser-actions recorded flow-image-cdp-candidates with only the old flow-content URL. Read-only inspection immediately after the failure showed an asb URL, and page fetch of that asb URL returned HTTP 200 image/webp with valid bytes.`
- `ROOT_CAUSE`: `The CDP fallback caused the Flow page to refresh into its final asb-backed tile, but getFlowImageBuffer treated a failed exact-source CDP capture as terminal and did not run a post-reload candidate scan.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs getFlowImageBuffer`
- `FAILURE_CALL_CHAIN`: `Flow output flow-content candidate → bounded page observation exhausted → exact-source CDP reload → Flow rendered asb source → no post-reload page observation → generic image download error → Stage 3 FAILED.`
- `RELEVANT_EVIDENCE`: `Attempt 21 settled FAILED with assetCount=0 and executionLease=null. browser-actions recorded candidate observation at 01:33:38 and CDP candidate at 01:35:39. At 01:42:15 the handler threw; read-only CDP inspection showed a new flow.google.com/asb image source and page fetch returned a valid image/webp response.`
- `RECOMMENDED_REPAIR`: `After the exact-source CDP fallback returns no body, re-scan the current Flow DOM for the new generated-image source and run the same validated page-context capture once more before failing. Keep the CDP fallback fail-closed and do not substitute screenshots.`
- `CHOSEN_REPAIR`: `After exact-source CDP capture returns no body, re-scan the live Flow DOM for the post-reload source and run the same validated page-context candidate capture for a bounded 45 seconds before failing.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Static contract coverage for post-CDP DOM re-observation and the post-reload page-fetch success path.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 71 tests; typecheck PASS; node --check electron/main.cjs and scripts/recovery-desktop-runtime.mjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 23 completed Stage 3; renderer readback was validated separately after the recovery runtime restart.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=21; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No retry-count expansion, pipeline timeout change, database reset, browser-profile cleanup, cookie deletion, or new run was performed.`

### ISSUE-019

- `ISSUE_ID`: `ISSUE-019`
- `REGRESSION_OF`: `ISSUE-017, ISSUE-018`
- `DISCOVERED_AT`: `2026-09-21T08:55:38+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `22`
- `STAGE`: `3 — Tạo và kiểm tra ảnh Gemini bằng trình duyệt`
- `JOB/SCENE`: `automatic-pipeline / Flow image candidate discovery`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_CANDIDATE_DISCOVERY_EXPRESSION_INVALID`
- `SYMPTOM`: `The post-CDP candidate loop still returned only the old flow-content source and never observed the live asb sources. Stage 3 exhausted both slot attempts and failed with the generic Edge/CDP image-download error.`
- `LAST_CONFIRMED_GOOD_STATE`: `The managed Edge page contained generated image tiles and the live DOM exposed flow.google.com/asb URLs after the Flow reload.`
- `EXPECTED_STATE`: `listFlowImageSources returns both flow-content.google/image and flow.google.com/asb image URLs from the current DOM.`
- `ACTUAL_STATE`: `The helper expression was built inside a JavaScript template literal using regex slash escapes. The resulting expression lost the slash escapes and was syntactically invalid; executeFlowJavaScript caught the evaluation error and listFlowImageSources silently returned [].`
- `ROOT_CAUSE`: `Incorrect escaping of a regex literal embedded in the template-string browser expression caused candidate discovery to fail closed as an empty list. The existing catch concealed the expression error, so the stale initial source remained the only candidate.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs listFlowImageSources/getFlowImageBuffer`
- `FAILURE_CALL_CHAIN`: `Flow generated output → candidate list expression evaluated invalid regex → [] returned → only stale flow-content source retried → CDP reload/post-scan still lacked discovered asb candidate → image download error → Stage 3 FAILED.`
- `RELEVANT_EVIDENCE`: `Attempt 22 settled FAILED with assetCount=0 and executionLease=null. browser-actions recorded count=1 for every candidate scan. Read-only Node evaluation of the exact template-string regex showed the resulting expression was invalid; read-only Edge inspection showed two valid asb image URLs and direct page fetch returned valid image/webp bytes in the same session.`
- `RECOMMENDED_REPAIR`: `Replace the fragile embedded regex with explicit startsWith checks for the two allowed Flow image origins, retain source deduplication and byte/mime validation, and add a regression test that evaluates the exact browser expression semantics.`
- `CHOSEN_REPAIR`: `Replaced the embedded regex with explicit startsWith checks for the two allowed Flow image origins, preserving deduplication and fail-closed byte/mime validation.`
- `FILES_CHANGED`: `electron/main.cjs; electron/gemini-send-contract.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Static contract coverage for both explicit source-prefix checks, plus the existing candidate re-observation and post-CDP paths.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 71 tests; typecheck PASS; node --check electron/main.cjs and scripts/recovery-desktop-runtime.mjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 23 discovered the live Flow asb candidates, captured valid image bytes, and completed Stage 3.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=22; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518; assetCount=0.`
- `NOTES`: `No retry-count expansion, pipeline timeout change, database reset, browser-profile cleanup, cookie deletion, or new run was performed.`

### ISSUE-020

- `ISSUE_ID`: `ISSUE-020`
- `REGRESSION_OF`: `ISSUE-019`
- `DISCOVERED_AT`: `2026-09-21T09:14:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `23`
- `STAGE`: `3 — post-stage asset accessibility validation`
- `JOB/SCENE`: `automatic-pipeline / generated image readback`
- `FIRST_DIVERGENCE`: `RECOVERY_RENDERER_AND_ELECTRON_USERDATA_MISMATCH`
- `SYMPTOM`: `Stage 3 reported five saved images and the files exist in the managed recovery userData directory, but renderer image readback requests returned HTTP 404 because the renderer served from the default application data directory while Electron saved images in the recovery userData directory.`
- `LAST_CONFIRMED_GOOD_STATE`: `Attempt 23 completed Stage 3 with five validated image/webp downloads, executionLease=null, and five image files present under the recovery userData generated-images directory.`
- `EXPECTED_STATE`: `Renderer/API image reads and Electron image writes resolve the same userData root during the recovery runtime.`
- `ACTUAL_STATE`: `scripts/recovery-desktop-runtime.mjs passed MODELING_AI_USER_DATA_DIR only to Electron. The Next renderer inherited the default environment, so src/modules/assets/image-generation-service.ts resolved generated-images under AppData\\Roaming\\ai-content-modeling while Electron wrote under the recovery temp userData root.`
- `ROOT_CAUSE`: `Recovery launcher did not propagate its isolated userData override to the renderer process, producing a split storage root for generated media.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/modules/assets/image-generation-service.ts readProjectImage / scripts/recovery-desktop-runtime.mjs`
- `FAILURE_CALL_CHAIN`: `Electron saveFlowImage -> recovery userData generated-images -> renderer generated-image URL -> renderer default app-data root -> IMAGE_NOT_FOUND/HTTP 404.`
- `RELEVANT_EVIDENCE`: `Attempt 23 DB status PAUSED/lastCompletedStage=3; five files background-0.webp and scene-1.webp through scene-4.webp exist under C:\\Users\\Admin\\AppData\\Local\\Temp\\modeling-ai-issue005-live\\generated-images\\cmuagw9cx0001k5806rv7o518; renderer log showed GET /api/v1/projects/.../images for all five slots returning 404.`
- `RECOMMENDED_REPAIR`: `Propagate a recovery-only generated-media root to the renderer and Electron launcher so both resolve the same isolated media directory while the shared production DB remains unchanged.`
- `CHOSEN_REPAIR`: `Added MODELING_AI_GENERATED_MEDIA_ROOT to the shared recovery environment and made the image-generation service resolve generated media from that override, leaving production defaults unchanged.`
- `FILES_CHANGED`: `scripts/recovery-desktop-runtime.mjs; scripts/recovery-desktop-runtime.test.ts; src/modules/assets/image-generation-service.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Recovery launcher contract coverage for generated-media-root propagation.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 71 tests; typecheck PASS; node --check electron/main.cjs and scripts/recovery-desktop-runtime.mjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — after one runtime restart, renderer readback returned HTTP 200 image/webp for background-0 and scene-1 through scene-4, with byte sizes 6640, 6640, 9892, 10122, and 7558.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=PAUSED; lastCompletedStage=3; failedStage=null; resumeTarget=null; attemptCount=23; executionLease=null; contentProjectId=cmuagw9cx0001k5806rv7o518.`
- `NOTES`: `No production AppData, database, browser profile, cookies, .env, or historical run data was deleted or reset.`

### ISSUE-021

- `ISSUE_ID`: `ISSUE-021`
- `REGRESSION_OF`: `ISSUE-020`
- `DISCOVERED_AT`: `2026-09-21T09:33:05+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `24`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / resume from completed Stage 3`
- `FIRST_DIVERGENCE`: `STAGE_4_RESUME_REEXECUTES_COMPLETED_STAGE_3`
- `SYMPTOM`: `Tiếp tục phiên chạy từ videos nhưng pipeline gọi lại changeStep(images, running). API từ chối vì trạng thái bước đã hoàn tất bị lùi về running; UI hiển thị Resume state không nhất quán; outer failure persistence cũng không thể lưu với step state không đơn điệu.`
- `LAST_CONFIRMED_GOOD_STATE`: `Attempt 23 PAUSED with lastCompletedStage=3, images completed, failedStage=null, resumeTarget=null, executionLease=null.`
- `EXPECTED_STATE`: `Resume Stage 4 phải giữ nguyên modeling-idea, content-project và images ở completed, chỉ đặt videos ở running rồi tiếp tục tạo video.`
- `ACTUAL_STATE`: `runAutomaticPipeline fetched the existing Content Project, then unconditionally entered the images branch and attempted to transition images from completed to running before reaching generateAllProjectVideos.`
- `ROOT_CAUSE`: `The automatic pipeline has a resume-stage guard for Content Project but no equivalent guard for Images and Videos. On a Stage-4 resume it always executes Stage 3 image generation, producing a non-monotonic step transition and RESUME_STATE_INCONSISTENT.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/components/viral-dashboard.tsx runAutomaticPipeline / changeStep; src/app/api/v1/automations/route.ts PATCH`
- `FAILURE_CALL_CHAIN`: `Resume decision failedStage=4 → resume state set to videos → existing project loaded → unconditional images running transition → buildAuthoritativePersistencePatch rejects non-monotonic steps → 409 RESUME_STATE_INCONSISTENT → catch persistence also rejected → stale RUNNING lease remained.`
- `RELEVANT_EVIDENCE`: `DB attempt 24 had status=RUNNING, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, activeStage=videos, heartbeat stopped at 2026-09-21T02:30:36.127Z; renderer showed Đang tiếp tục phiên chạy từ videos and Resume state không nhất quán; no Flow video generation request was observed.`
- `RECOMMENDED_REPAIR`: `Make the pipeline execute only the selected resume stage and later stages: skip Images when resumeStage >= 4, skip Content Project when resumeStage >= 3, and preserve completed step state. Ensure the failure path can settle the run with a valid monotonic failed-step checkpoint.`
- `CHOSEN_REPAIR`: `Gate the automatic pipeline by target resume stage; hydrate completed image/video artifacts from their persisted API endpoints instead of re-running completed stages.`
- `FILES_CHANGED`: `src/components/viral-dashboard.tsx; src/components/viral-dashboard.ui.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `CASE14 coverage for targetStage image/video guards and persisted media loaders.`
- `TEST_RESULTS`: `PASS — targeted Vitest 4 files / 62 tests; typecheck PASS; electron/main.cjs syntax PASS; recovery runtime syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — attempt 25 skipped completed Stage 3, loaded all five persisted image URLs with HTTP 200, and reached Stage-4 Prompt Fidelity preparation. The downstream false-positive validator failure is tracked separately as ISSUE-022.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=25; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No new run, database reset, browser-profile cleanup, cookie deletion, production AppData deletion, or source-data deletion was performed.`

### ISSUE-022

- `ISSUE_ID`: `ISSUE-022`
- `DISCOVERED_AT`: `2026-09-21T09:38:57+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `25`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Prompt Fidelity preparation for video scenes 2 and 3`
- `FIRST_DIVERGENCE`: `VIDEO_PROMPT_FIDELITY_GATE_FALSE_POSITIVE`
- `SYMPTOM`: `Stage 4 loaded all five persisted images successfully, then prompt-fidelity preparation returned HTTP 409 for scenes 2 and 3. Scene 2 failed PROMPT_CAMERA_MATCH and scene 3 failed PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION; no Flow video generation request started and the renderer reported the generic video-creation failure.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 3 completed with five readable persisted images; scene 1 video prompt preparation passed and created a VIDEO PromptFidelityTrace.`
- `EXPECTED_STATE`: `The compiler-generated authoritative video contract and approved scene start-frame wording must validate without being treated as new creative instructions.`
- `ACTUAL_STATE`: `The validator's positive-content scan treated VIDEO CAMERA / FRAMING (authoritative) as creative text, so Medium close-up was detected as a forbidden close-up conflict. It also treated VIDEO SCENE APPEARANCE (authoritative), containing the approved start-frame word dance, as an unauthorized addition.`
- `ROOT_CAUSE`: `positiveLines() excluded the generic SCENE APPEARANCE STATE block but did not recognize the compiler's VIDEO authoritative block labels. The validator therefore re-scanned its own authoritative video contract as user creativity and rejected valid scenes.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/modules/prompt-fidelity/validator.ts sourceChecks/positiveLines; src/modules/prompt-fidelity/service.ts preparePromptForGeneration`
- `FAILURE_CALL_CHAIN`: `Stage-4 resume → persisted image hydration → preparePromptForFlow(scene 2/3) → compileStrictVideoPrompt → positiveLines misclassifies VIDEO authoritative blocks → Prompt Fidelity Gate 409 → video generation not started → generic Stage-4 failure persisted.`
- `RELEVANT_EVIDENCE`: `Authenticated API validation returned scene 2 failedValidators=[PROMPT_CAMERA_MATCH] with shotConflict=true and scene 3 failedValidators=[PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION] with actual=[dance]. Scene 1 passed. DB incidents at 2026-09-21T02:38:57Z record the same exact validators and approved source action evidence.`
- `RECOMMENDED_REPAIR`: `Extend the authoritative-line classifier to cover the exact VIDEO contract labels emitted by compileStrictVideoPrompt, then add regression coverage for Medium close-up and approved dance wording.`
- `CHOSEN_REPAIR`: `Extend the authoritative-line classifier to cover the exact VIDEO contract labels emitted by compileStrictVideoPrompt, preserving fail-closed validation for appended creative text.`
- `FILES_CHANGED`: `src/modules/prompt-fidelity/validator.ts; src/modules/prompt-fidelity/validator.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `CASE48 verifies a Medium close-up plus approved start-frame dance wording passes; CASE49 verifies appended jump/dance remains blocked.`
- `TEST_RESULTS`: `PASS — targeted Vitest 5 files / 111 tests; typecheck PASS; electron/main.cjs syntax PASS; recovery runtime syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — after renderer restart, authenticated prompt-fidelity validation returned HTTP 200 for VIDEO scenes 1–4; attempt 26 passed the gate and reached Flow project creation.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=25; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No retry-count expansion, timeout increase, database reset, browser-profile cleanup, cookie deletion, .env change, or new run was performed. The gate remains active; only its own authoritative VIDEO contract is excluded from the creative-addition scan.`

### ISSUE-023

- `ISSUE_ID`: `ISSUE-023`
- `DISCOVERED_AT`: `2026-09-21T09:52:34+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `26`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 1 prompt submission`
- `FIRST_DIVERGENCE`: `FLOW_PROMPT_INPUT_NOT_ACCEPTED_BY_NATIVE_COMPOSER_STATE`
- `SYMPTOM`: `Prompt Fidelity returned HTTP 200 for scenes 1–4 and Flow opened a new project with scene-1.webp attached. The visible Flow composer contained the prompt after the app inserted it, but Start generation remained disabled; no generated video, video card, or video source appeared. The bounded reload path then failed with “Google Flow không trả về video sau khi tải lại trang.”`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow project ready; start-frame image uploaded and attached; validated scene-1 prompt prepared and saved in the manual-flow checkpoint.`
- `EXPECTED_STATE`: `Native Flow composer state contains the exact validated prompt and enables Start generation before the click; a generated video source/card then appears.`
- `ACTUAL_STATE`: `The renderer displayed the prompt text but the contenteditable application's internal state was unchanged, so Start generation was disabled. Read-only reproduction on the same managed Flow page showed DOM execCommand + synthetic InputEvent left the button disabled, while CDP Input.insertText enabled it.`
- `ROOT_CAUSE`: `Stage-4 video submission used document.execCommand('insertText') plus synthetic input/change events for Flow's contenteditable composer. Flow's native composer state did not accept that synthetic insertion, so the generation control stayed disabled and no generation request was sent.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs setFlowPrompt/runFlowVideoJobUnlocked/waitForFlowVideoWithRecovery`
- `FAILURE_CALL_CHAIN`: `Validated VIDEO prompt → synthetic DOM insertion displayed text only → Flow Start generation remained disabled → no generation request/result → bounded reload observed no video → Stage 4 persisted generic video failure.`
- `RELEVANT_EVIDENCE`: `Attempt 26 DB settled FAILED with lastCompletedStage=3, failedStage=4, executionLease=null. Flow project f398b0f0-0569-410b-9097-c79f180ecc02 showed scene-1.webp, empty generation result and disabled Start generation after reload. Direct CDP reproduction on that authenticated project showed contenteditable text present with disabled=true after execCommand; the same focused input became disabled=false after Input.insertText. No generated video source/card was present.`
- `RECOMMENDED_REPAIR`: `Use native CDP Input.insertText for the managed Edge contenteditable, verify the exact prompt was accepted and Start generation is enabled, then click. Keep the existing DOM fallback only for non-Edge runtimes and fail closed if Flow still rejects the prompt.`
- `CHOSEN_REPAIR`: `Added setFlowPrompt() with native Edge CDP text insertion, exact normalized prompt readback, generation-control enabled post-condition, and browser-action diagnostics; replaced the Stage-4 synthetic prompt insertion with this contract.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Regression coverage verifies native Input.insertText, prompt readback/control enablement, and removal of the old synthetic insertion from runFlowVideoJobUnlocked.`
- `TEST_RESULTS`: `Pending targeted validation.`
- `LIVE_VALIDATION`: `Pending runtime restart and same-run Stage-4 validation.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=26; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No database reset, browser-profile cleanup, cookie deletion, production AppData deletion, new run, retry-count expansion, or timeout increase was performed.`

### ISSUE-024

- `ISSUE_ID`: `ISSUE-024`
- `DISCOVERED_AT`: `2026-09-21T10:12:40+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `27`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 1 prompt submission`
- `FIRST_DIVERGENCE`: `FLOW_PROMPT_READBACK_MISCLASSIFIED_CONTENTEDITABLE_TEXT`
- `SYMPTOM`: `The patched Flow prompt path inserted the full prompt through native Edge CDP input and Flow enabled Start generation, but setFlowPrompt threw FLOW_PROMPT_INPUT_NOT_ACCEPTED before clicking because its readback selected contenteditable.textContent. The visible Flow composer therefore appeared correct while the automation stopped before generation.`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow project 0baa9ded-9cb8-493f-ae4d-439b0c9d592b was ready, scene-1.webp was attached, and the native prompt insertion completed.`
- `EXPECTED_STATE`: `Read back the contenteditable using rendered text semantics, normalize whitespace, confirm exact prompt identity and enabled Start generation, then continue to the generation click.`
- `ACTUAL_STATE`: `On the failed attempt, browser-actions.ndjson recorded expectedLength=5173, observedLength=5130, sendDisabled=false. Read-only inspection then showed innerText length 5216 and textContent length 5130; normalize(innerText) exactly matched the expected 5173-character prompt while normalize(textContent) did not. Start generation was enabled, proving the failure was a false readback rejection.`
- `ROOT_CAUSE`: `setFlowPrompt used input?.value || input?.textContent || '' for a contenteditable. Flow stores/rendered line breaks and spacing in innerText; textContent omits the separators, so the validator rejected a prompt that Flow had actually accepted.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs setFlowPrompt:4758; runFlowVideoJobUnlocked:5531`
- `FAILURE_CALL_CHAIN`: `Stage-4 resume → Flow project/image ready → native CDP Input.insertText → contenteditable accepts prompt and enables Start generation → textContent-only readback reports length 5130 vs expected 5173 → FLOW_PROMPT_INPUT_NOT_ACCEPTED → renderer persists generic Stage-4 failure before generation click.`
- `RELEVANT_EVIDENCE`: `Attempt 27 settled FAILED with lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, attemptCount=27, executionLease=null. Flow URL was https://flow.google.com/project/0baa9ded-9cb8-493f-ae4d-439b0c9d592b. The live page contained the full prompt and an enabled Start generation button. Independent CDP readback proved normalize(innerText) === normalize(expectedPrompt) and normalize(textContent) !== normalize(expectedPrompt). No video generation request was started.`
- `RECOMMENDED_REPAIR`: `For contenteditable Flow readback, use innerText (or an equivalent rendered-text extraction) before whitespace normalization; retain value for textarea and keep the enabled-control postcondition. Add a regression test for contenteditable textContent loss with innerText exact-match.`
- `CHOSEN_REPAIR`: `Read contenteditable prompt text through innerText before whitespace normalization, while retaining textarea.value and the enabled Start generation postcondition.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Regression coverage verifies contenteditable rendered innerText is used and the textContent-only readback is absent.`
- `TEST_RESULTS`: `PASS — targeted Vitest 6 files / 116 tests; typecheck PASS; electron/main.cjs syntax PASS; recovery runtime syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS for the repaired boundary — attempt 28 recorded expectedLength=5173, observedLength=5173, sendDisabled=false, and the Flow generation control was clicked. The downstream provider block is recorded as ISSUE-025.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=28; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No retry, production resume, database reset, browser-profile cleanup, cookie deletion, .env change, or new run was performed after this failure. The prior ISSUE-023 native-input repair remains in the worktree but is not marked live-fixed until this readback defect is repaired and validated.`

### ISSUE-025

- `ISSUE_ID`: `ISSUE-025`
- `DISCOVERED_AT`: `2026-09-21T10:34:00+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `28`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 1 generation`
- `FIRST_DIVERGENCE`: `FLOW_GENERATION_REQUEST_BLOCKED`
- `SYMPTOM`: `Flow accepted the exact prompt and enabled Start generation, but immediately displayed “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” No video card, video source, or generation request appeared; the app later reported the generic no-video failure.`
- `LAST_CONFIRMED_GOOD_STATE`: `Attempt 28 Flow project was ready, scene-1.webp was attached, prompt readback matched exactly (5173 normalized characters), and Start generation was enabled.`
- `EXPECTED_STATE`: `After the native generation click, Google Flow creates a generation request and eventually exposes a generated video/card.`
- `ACTUAL_STATE`: `Google Flow returned its provider-side unusual-activity/anti-abuse block before generation. The account UI showed the expected signed-in account and 50 Flow credits; the account was not credit-blocked. A user-reported manual new-chat send succeeded, confirming the account/profile and prompt content are usable while the automated action pattern is blocked.`
- `ROOT_CAUSE`: `Google Flow anti-abuse protection blocked the automated generation action before a generation request was created. Rapid consecutive browser actions/projects are a plausible contributing trigger, but Google's internal threshold is not observable; no safe code change can bypass that provider decision.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow generation UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Flow prompt accepted → native Start generation click → Flow unusual-activity block → no generation request/video → previous 600-second/reload fallback would misclassify the provider block as generic no-video failure.`
- `RELEVANT_EVIDENCE`: `Direct read-only CDP observation on the canonical Flow profile showed the exact unusual-activity text, no video/thumbnail, no generation/video request, and “You have not been charged”. The account menu showed ULTRA tier with 50 credits. User-provided screenshot/report shows a manual new-page prompt succeeds. DB attempt 28 settled FAILED with lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null.`
- `RECOMMENDED_REPAIR`: `Keep generation fail-closed and surface FLOW_UNUSUAL_ACTIVITY_BLOCK immediately with manual-action guidance. Do not retry/reload blindly, increase retry count, clear profile data, or attempt to bypass Google anti-abuse. After the provider block is cleared naturally or the user completes any required Google Help Center action, use the existing manual Flow handoff/checkpoint to finish the current scene.`
- `CHOSEN_REPAIR`: `Added explicit unusual-activity/not-charged detection, structured FLOW_UNUSUAL_ACTIVITY_BLOCK with first-divergence evidence, immediate terminal failure before the generic reload/timeout path, and renderer propagation so the structured provider failure is not converted to null/generic Stage-4 text.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; src/components/viral-dashboard.tsx; src/components/viral-dashboard.ui.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Flow generation blocker contract verifies anti-abuse detection, structured code, evidence, and fail-fast placement before the polling delay/recovery path. UI contract verifies generateAllProjectVideos rethrows real Flow failures.`
- `TEST_RESULTS`: `PASS — targeted Vitest 5 files / 54 tests; typecheck PASS; electron/main.cjs syntax PASS; recovery runtime syntax PASS; live-debug state JSON PASS; git diff --check PASS; clean production build PASS. Full suite remains non-green for 78 pre-existing/environment-dependent failures, chiefly TEST_FFMPEG_NOT_FOUND and stale captured-evidence assertions.`
- `LIVE_VALIDATION`: `PASS for diagnosis — automated Flow attempt reproduced the exact provider block; manual user test subsequently succeeded on a new Flow page. The production run remains blocked because the provider has not granted automated generation access.`
- `STATUS`: `OPEN`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=29; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `Attempt 29 resumed the same run after the user command. The exact FLOW_UNUSUAL_ACTIVITY_BLOCK reproduced immediately at Stage 4 before a generation request; DB error preserved the structured code. No production resume beyond this user-requested attempt, new AutomationRun, retry-count expansion, timeout increase, database reset, browser-profile cleanup, cookie deletion, .env change, or anti-abuse bypass was performed. The code-side handling is repaired; external Flow access still requires the provider block to clear or a user-controlled manual handoff.`

### ISSUE-026

- `ISSUE_ID`: `ISSUE-026`
- `DISCOVERED_AT`: `2026-09-21T10:58:58+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `29`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `Flow provider generation / scene 1 / sceneId=cmuagw9cy0002k580ignrdx2q`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `Flow showed “Failed — We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” immediately after the generation action. No video card, video source, provider job id, or generated video appeared.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 3 completed; Stage 4 opened Flow project 9e9cc35d-c36d-42be-82ee-c218e39dcfba, attached scene-1.webp, displayed the validated VIDEO prompt, and reached the Generate action.`
- `EXPECTED_STATE`: `After the correct source image and validated prompt are submitted, Flow creates a provider generation job and exposes a video card/source.`
- `ACTUAL_STATE`: `Flow UI completed the interaction up to Generate, then returned the provider unusual-activity block. The page showed ULTRA and a low-credits notice; the canonical managed account/profile remained signed in. There was no video element/card and no provider generation job persisted in the local VideoGeneration/VideoGenerationJob tables.`
- `ROOT_CAUSE`: `Google Flow provider-side anti-abuse/unusual-activity protection rejected the video-generation action before a provider job was created. The evidence does not support upload failure, prompt-input failure, or content-safety rejection as the first failing layer.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Stage 3 PASS → Flow project opened → scene-1.webp attached → exact validated VIDEO prompt present → Generate clicked → provider unusual-activity UI failure → no provider job/video → Stage 4 settled FAILED.`
- `RELEVANT_EVIDENCE`: `DB: attemptCount=29, status=FAILED, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, checkpoint.executionLease=null, error=FLOW_UNUSUAL_ACTIVITY_BLOCK. Flow URL=https://flow.google.com/project/9e9cc35d-c36d-42be-82ee-c218e39dcfba. Read-only DOM showed the exact error text, scene-1.webp, full validated prompt, ULTRA account context and no video element. Read-only performance evidence showed Flow batchexecute/analytics activity but no observable generation/video request id or provider job status. Local DB has 4 storyboard scenes, all prompt/start-frame ready; no VideoGenerationJob or VideoGeneration row exists for the project scenes. Existing attempts 28–29 reproduced the same provider block; no automatic retry was performed during this investigation.`
- `RECOMMENDED_REPAIR`: `Do not retry or patch the generation path now. Keep the run paused/failed and require a user-controlled provider recovery decision: wait for the Flow unusual-activity restriction to clear or complete any Google Help Center/account action manually, then resume the canonical Stage-4 checkpoint once the provider accepts a harmless manual generation. Do not change account/profile or delete cookies.`
- `CHOSEN_REPAIR`: `Map the exact Flow unusual-activity/not-charged UI state to FLOW_PROVIDER_UNUSUAL_ACTIVITY with firstDivergence=FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK; make it terminal and non-auto-retryable; settle Stage 4 at the Stage 3 → VIDEOS checkpoint; preserve structured error metadata through direct IPC and the desktop Flow bridge; expose manual Flow/Resume actions without triggering Retry.`
- `FILES_CHANGED`: `electron/main.cjs; electron/preload.cjs; electron/gemini-error-transport.cjs; src/modules/generation/browser-flow-bridge.ts; src/app/api/v1/desktop-flow/jobs/[id]/complete/route.ts; src/components/viral-dashboard.tsx; electron/flow-prompt-input.test.ts; electron/gemini-send-contract.test.ts; src/components/viral-dashboard.ui.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Provider unusual-activity structured error/evidence contract; non-retryable recovery contract; structured direct-video IPC transport; dashboard manual-action contract; completed-video preservation contract.`
- `TEST_RESULTS`: `PASS — targeted Vitest 3 files / 42 tests; typecheck PASS; electron/main.cjs syntax PASS; electron/preload.cjs syntax PASS; git diff --check completed with only existing CRLF normalization warnings. Production build compiled and type-checked but Next page-data collection failed in the existing generated-route environment with PageNotFoundError entries; no production pipeline was run.`
- `LIVE_VALIDATION`: `NOT_RUN — per instruction, no automated or manual Flow generation was attempted after repair. The external provider block therefore remains unverified/active.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — run remains at lastCompletedStage=3, resumeTarget=VIDEOS, executionLease=null; Scene 1 remains incomplete.`
- `MANUAL_FLOW_GENERATION`: `NOT_RUN`
- `PROVIDER_BLOCK_CLEARED`: `UNKNOWN`
- `STATUS`: `EXTERNAL_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=29; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `VIDEO_JOB_COUNT_REQUIRED=4; VIDEO_JOB_COUNT_ATTEMPTED=1 (scene 1); VIDEO_JOB_COUNT_SUCCEEDED=0. SOURCE_IMAGE_BOUND=YES; VIDEO_PROMPT_READY=YES; FINAL_REFERENCE_STATE=scene-1.webp attached; GENERATE_TRIGGERED=YES; GENERATION_STARTED=NO; PROVIDER_JOB_CREATED=NO; PROVIDER_JOB_FAILED=NO (failure occurred before provider job creation). Code repair is validated synthetically only. No production generation, automatic retry, account/profile change, cookie deletion, DB reset, new run, or Stage 5 continuation was performed. Wait for provider recovery and explicit user CONTINUE.`

## Issue Record Template

Copy this template for each new issue. Do not delete historical records.

### ISSUE-XXX

- `ISSUE_ID`:
- `DISCOVERED_AT`:
- `RUN_ID`:
- `ATTEMPT`:
- `STAGE`:
- `JOB/SCENE`:
- `FIRST_DIVERGENCE`:
- `SYMPTOM`:
- `LAST_CONFIRMED_GOOD_STATE`:
- `EXPECTED_STATE`:
- `ACTUAL_STATE`:
- `ROOT_CAUSE`:
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED` / `PROVISIONAL` / `UNKNOWN`
- `ERROR_THROW_SITE`:
- `FAILURE_CALL_CHAIN`:
- `RELEVANT_EVIDENCE`:
- `RECOMMENDED_REPAIR`:
- `CHOSEN_REPAIR`:
- `FILES_CHANGED`:
- `TESTS_ADDED`:
- `TEST_RESULTS`:
- `LIVE_VALIDATION`:
- `STATUS`: `OPEN` / `REPAIRING` / `FIXED` / `REGRESSION`
- `RESUME_CHECKPOINT`:
- `NOTES`:

### ISSUE-027

- `ISSUE_ID`: `ISSUE-027`
- `REGRESSION_OF`: `ISSUE-026`
- `DISCOVERED_AT`: `2026-09-21T11:50:55+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `31`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 1 / sceneId=cmuagw9cy0002k580ignrdx2q`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `Stage 4 resumed from the canonical VIDEOS checkpoint, opened Flow, bound the scene-1 image and reached Generate; Flow again displayed the exact unusual-activity/not-charged failure before any video job or video source was created.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 3 completed; persisted five image assets were loaded; scene 1 prompt-fidelity preparation completed; Flow upload/prompt preparation reached the provider Generate action.`
- `EXPECTED_STATE`: `Flow accepts Generate, creates a provider job, and exposes a video card/source for scene 1.`
- `ACTUAL_STATE`: `The first automated generation was rejected with FLOW_PROVIDER_UNUSUAL_ACTIVITY. The patched runtime then performed the user-requested single reload/rebind/resend recovery; Flow rejected that second automated send with the same provider message. The run settled FAILED at lastCompletedStage=3 with resumeTarget=VIDEOS and executionLease=null; no scene video was persisted in the app. A subsequent read-only inspection of the same canonical managed Flow browser showed one Generated video thumbnail for scene 1, no unusual-activity text, and a stable project page, confirming the user's manual generation succeeded.`
- `ROOT_CAUSE`: `The external Google Flow anti-abuse/unusual-activity restriction remains active. This recurs from ISSUE-026; it is not an upload, prompt-fidelity, renderer, or checkpoint error. The provider rejection occurs after the app completes the UI interaction and before provider job creation.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Same-run resume → persisted image hydration → prompt-fidelity PASS → Flow project/image/prompt preparation → Generate click → provider unusual-activity block → no provider job/video → structured Stage-4 failure → lifecycle settlement.`
- `RELEVANT_EVIDENCE`: `DB after attempt 31: status=FAILED, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null, error=FLOW_PROVIDER_UNUSUAL_ACTIVITY, projectId=cmuagw9cx0001k5806rv7o518. Runtime browser-actions evidence shows the first structured block at 2026-09-21T06:52:49Z, one flow-provider-block-reload-recovery event with recoveryAttempt=1/recoveryBudget=1, then a second structured block at 2026-09-21T06:53:13Z. Read-only CDP inspection of the canonical Edge profile at PID 23324, port 9333, URL https://flow.google.com/project/74bae1e1-a659-4d74-bdec-c3757056206b found one img[alt=\"Generated video thumbnail\"] for \"Character holding papers in office\", no unusual-activity text, no not-charged text, and the same result remained after a 6-second observation. No local VideoGenerationJob/VideoGeneration row was created by the failed app run.`
- `RECOMMENDED_REPAIR`: `No code or retry repair is safe for this recurrence. Keep the run paused at VIDEOS and require provider-side recovery: wait for the restriction to clear or complete any Google Flow Help Center/manual account action, then perform one user-controlled harmless manual generation check before another explicit same-run CONTINUE. Do not change account/profile, delete cookies, rotate IPs, or bypass anti-abuse.`
- `CHOSEN_REPAIR`: `Added one bounded, user-authorized reload/rebind/resend recovery for this exact Flow page state. The recovery never changes account/profile/IP, never loops, and preserves the structured provider error when the second send is also blocked.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Regression coverage verifies the one-recovery budget, reload-and-resend callback, structured second-block propagation, and re-binding of the scene image/prompt before the resend.`
- `TEST_RESULTS`: `PASS — targeted Vitest 2 files / 26 tests; typecheck PASS; electron/main.cjs syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `Automated live validation: PASS for the bounded recovery behavior (first block → one reload/rebind/resend); the second automated send was correctly blocked again and the run stopped. Manual live validation: PASS — the same canonical managed Edge profile now shows one Generated video thumbnail for scene 1, no unusual-activity/not-charged text, and the project remained stable for 6 seconds.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO` (no unbounded retry; exactly one explicit reload/rebind/resend recovery was consumed)
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; executionLease=null; Scene 1 remains incomplete.`
- `STATUS`: `FIXED / READY_FOR_CONTINUE (manual provider validation PASS; production run remains FAILED until explicit resume)`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=31; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `The user reported that reloading Flow and sending manually succeeded; read-only CDP verification confirmed one generated video thumbnail on the canonical Flow project and no active unusual-activity banner. The app's failed attempt did not persist that manual card into the local VideoGeneration tables, so no scene was marked complete and Stage 5 was not started. The next action is an explicit CONTINUE to resume the canonical run/checkpoint; do not create a new run.`

### ISSUE-028

- `ISSUE_ID`: `ISSUE-028`
- `DISCOVERED_AT`: `2026-09-21T14:13:06+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `31` (persisted attempt counter; this failure occurred during the subsequent continuation action)
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `manual-flow:cmuagw9cx0001k5806rv7o518:scene-1` / automatic resume of `VIDEOS`
- `FIRST_DIVERGENCE`: `MANUAL_FLOW_VIDEO_NOT_IMPORTED_BEFORE_STAGE4_RESUME`
- `SYMPTOM`: `The user requested the next prompt without repeating the manually successful scene-1 prompt. The Flow browser had a generated scene-1 card, but the app still had no persisted scene-1 video. The Resume action entered the automatic Stage-4 pipeline instead of importing the manual Flow checkpoint, so the app attempted to prepare scene 1 again and stopped at FLOW_ASPECT_RATIO_READY_TIMEOUT before any prompt was sent.`
- `LAST_CONFIRMED_GOOD_STATE`: `Canonical Flow project 74bae1e1-a659-4d74-bdec-c3757056206b contained one Generated video thumbnail for scene 1 and remained stable. The manual-flow checkpoint existed for scene 1.`
- `EXPECTED_STATE`: `The manual Flow checkpoint is consumed first: resumeAfterManualSubmission downloads the confirmed Flow card, persists scene-1 video in the app, marks the checkpoint COMPLETED, then the normal Stage-4 resume skips scene 1 and starts the first incomplete scene/prompt.`
- `ACTUAL_STATE`: `manual-flow checkpoint status remained WAITING_FOR_MANUAL_FLOW_SUBMISSION with no savedVideoPath/resolvedVideoSource; GET /api/v1/projects/cmuagw9cx0001k5806rv7o518/videos?sceneNumber=1 returned HTTP 404 VIDEO_NOT_FOUND; generated-videos directory was absent. The visible provider Resume button is wired to runAutomaticPipeline(), while resumeManualFlowSubmission() has no JSX call-site. The accidental continuation created Flow project b029ac2c-ede7-421f-a334-957f0513343e and failed at FLOW_ASPECT_RATIO_READY_TIMEOUT; browser-actions contained no new flow-prompt-input or generation event after 07:04:52Z.`
- `ROOT_CAUSE`: `The manual Flow handoff/import path exists as an unused renderer function, but the provider-error Resume control is wired to the generic automatic pipeline. There is no completed/persisted-video postcondition gate before Stage 4 continuation, so a manually successful scene is not recognized and the pipeline re-enters scene 1.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/components/viral-dashboard.tsx runAutomaticPipeline / provider Resume action; downstream electron/main.cjs FLOW_ASPECT_RATIO_READY_TIMEOUT`
- `FAILURE_CALL_CHAIN`: `Manual Flow card exists → manual checkpoint remains WAITING → app video API has no scene-1 record → Continue/Resume calls runAutomaticPipeline → Stage 4 selects scene 1 again → Flow project b029ac2c-ede7-421f-a334-957f0513343e opens → aspect-ratio readiness times out → run settles FAILED.`
- `RELEVANT_EVIDENCE`: `Read-only source search found resumeManualFlowSubmission() only at its definition; the visible provider Resume button calls runAutomaticPipeline(). The live app returned 404 VIDEO_NOT_FOUND for scene 1. manual-flow-submissions.json still records WAITING_FOR_MANUAL_FLOW_SUBMISSION with preSubmitCardCount=0 and no savedVideoPath. The persisted run is FAILED, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null, error=FLOW_ASPECT_RATIO_READY_TIMEOUT. No scene-1 prompt input or Generate action was recorded in browser-actions during this failed continuation.`
- `RECOMMENDED_REPAIR`: `Wire the explicit manual-handoff Resume action to resumeManualFlowSubmission(sceneNumber) and require a successful persisted video/checkpoint COMPLETED postcondition before allowing the same-run Stage-4 continuation. Hydrate persisted videos before selecting incomplete scenes; only then start the next incomplete scene. Keep the manually successful scene untouched and do not resend its prompt.`
- `CHOSEN_REPAIR`: `Not yet chosen; protocol requires waiting for an explicit REPAIR command after recording the failure.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — investigation only.`
- `TEST_RESULTS`: `Not run — investigation only.`
- `LIVE_VALIDATION`: `PASS — confirmed Flow media was captured without resending the prompt, saved as scene-1.mp4 (554773 bytes; MP4 ftyp header), checkpoint marked COMPLETED, and authenticated app API returned HTTP 200 video/mp4 for scene 1.`
- `STATUS`: `OPEN`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=31; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No scene-1 prompt was sent again. The existing Flow card was captured through the canonical Edge session and saved to the current runtime's generated-videos path; the app now serves it as an existing scene-1 video. The Resume UI wiring issue remains a code defect for future runs, but this current run has a valid persisted scene-1 checkpoint and may continue from the next incomplete scene. No new AutomationRun, cookie/profile cleanup, database reset, Stage 5 continuation, or provider retry was performed.`

### ISSUE-029

- `ISSUE_ID`: `ISSUE-029`
- `DISCOVERED_AT`: `2026-09-21T14:44:45+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `31`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `same-run automatic resume after scene-1 manual import / next incomplete video prompt`
- `FIRST_DIVERGENCE`: `MANUAL_FLOW_HANDOFF_RUNTIME_LOCK_HELD`
- `SYMPTOM`: `Scene 1 was successfully saved and the authenticated video API returned 200, but the next-prompt continuation stayed RUNNING with heartbeat and never opened a new Flow page or emitted a new prompt action.`
- `LAST_CONFIRMED_GOOD_STATE`: `scene-1.mp4 existed in the runtime generated-videos directory, checkpoint was marked COMPLETED, and GET /api/v1/projects/cmuagw9cx0001k5806rv7o518/videos?sceneNumber=1 returned 200 video/mp4.`
- `EXPECTED_STATE`: `The old manual handoff completes/releases its Flow operation, then automatic Stage 4 hydrates scene 1, skips it, opens Flow for the first incomplete scene and sends only the next prompt.`
- `ACTUAL_STATE`: `The manual handoff IPC call remained pending while trying to obtain/download Flow media. Source shows the IPC handler wraps resumeAfterManualFlowSubmission() in withFlowOperation(). The subsequent automatic run also enters withFlowOperation() but no Flow tab or browser-action event appears; the run heartbeat continues until explicitly settled as FAILED with executionLease=null.`
- `ROOT_CAUSE`: `The manual handoff operation did not settle after the video was captured, leaving the shared Flow operation queue occupied. The automatic Stage-4 operation was therefore blocked behind the stale in-process lock before it could process the next scene.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs flow-browser:resume-after-manual-submission IPC / withFlowOperation queue; lifecycle was settled by the automation PATCH boundary.`
- `FAILURE_CALL_CHAIN`: `Manual video captured and saved → prior resumeAfterManualSubmission promise remains pending → automatic Continue starts same run → runFlowVideoJob waits behind withFlowOperation → no new Flow page/prompt → run settled FAILED with MANUAL_FLOW_HANDOFF_RUNTIME_LOCK_HELD.`
- `RELEVANT_EVIDENCE`: `Authenticated app API confirmed scene-1 video HTTP 200 before continuation. DB/API showed status RUNNING, activeStage=videos and a live executionLease while no Flow page existed in Edge CDP and browser-actions had no event after the previous project setup. Source lines 5805–5813 wrap manual resume in withFlowOperation; source lines 5675–5677 wrap automatic video jobs in the same queue. The run was then explicitly settled FAILED with lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null.`
- `RECOMMENDED_REPAIR`: `Make manual handoff completion bounded and idempotent: once the confirmed Flow card is persisted, release the Flow operation in all success/failure/timeout paths; expose a completion postcondition to the renderer; and prevent automatic Stage-4 continuation while a manual handoff is pending. Do not send the scene-1 prompt again.`
- `CHOSEN_REPAIR`: `Make the manual handoff idempotent when the checkpoint video is already persisted; bound Flow media recovery; and close the handoff Flow window in a finally path so the shared withFlowOperation queue is released before automatic Stage 4 continuation.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `ISSUE-029 static regression tests for persisted-video idempotence, bounded manual media recovery, and unconditional Flow-window cleanup.`
- `TEST_RESULTS`: `PASS — electron/flow-prompt-input.test.ts: 10/10; npm run typecheck: PASS; node --check electron/main.cjs: PASS; git diff --check: PASS.`
- `LIVE_VALIDATION`: `Repair validation PASS. The patched handoff returns immediately for an existing scene-1 video and cannot reopen Flow in that path; an unpersisted handoff is bounded by MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT_MS and closes the Flow window in finally. Runtime continuation is the next validation step.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=31; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null; scene-1 video persisted.`
- `NOTES`: `No scene-1 prompt was sent again. The repair is source/test validated; the runtime was stopped after the failed attempt and must be restarted from the recovery worktree before continuing the same run. No new AutomationRun, profile/cookie cleanup, DB reset, Stage 5 continuation, or provider retry was performed.`

### ISSUE-030

- `ISSUE_ID`: `ISSUE-030`
- `DISCOVERED_AT`: `2026-09-21T15:06:11+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `32`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `scene 2 / Flow project 6cedde94-4bfa-458d-ae1f-28337053db3f`
- `FIRST_DIVERGENCE`: `FLOW_GENERATION_SUBMISSION_NOT_CONFIRMED_AFTER_BOUNDED_RETRY`
- `SYMPTOM`: `After the provider block recovery reloaded Flow and restored the scene-2 prompt, the app recorded flow-prompt-input success but no generation state, provider job, new card, or provider error appeared. The composer and Start generation control remained ready, so the pipeline would otherwise wait in the long video-result loop.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1 persisted locally; Stage 4 selected three incomplete scenes; scene-2 Flow project loaded, source image was bound, and the exact scene-2 prompt was accepted by Flow.`
- `EXPECTED_STATE`: `The Generate click produces an observable submission acknowledgment: provider error, generation/busy state, new card/source, or disabled/cleared composer.`
- `ACTUAL_STATE`: `The native CDP click path returned without an observable post-click state change after the bounded reload/resend. The Flow page still showed the scene-2 prompt and enabled Start generation button; browser-actions had only flow-prompt-input for the resend and no subsequent provider result.`
- `ROOT_CAUSE`: `The Generate click helper treated dispatch completion as submission success and had no bounded postcondition or DOM fallback when Flow did not register the native click. This allowed the result wait to hang instead of classifying the resend as unconfirmed.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs submitPreparedVideo / dispatchBrowserClick`
- `FAILURE_CALL_CHAIN`: `Stage-4 resume → scene-1 persisted-video hydration and skip → scene-2 Flow setup → prompt accepted → provider block → one reload/rebind/resend → native click returned without UI acknowledgment → 600-second result wait would hang.`
- `RELEVANT_EVIDENCE`: `browser-actions sequence 27/30 recorded prompt acceptance for scene 2 and sequence 28 recorded the first provider block; sequence 30 recorded the bounded resend prompt acceptance; read-only CDP inspection afterward showed no unusual-activity text, no Failed/Generating/Stop state, no generated card, and an enabled Start generation button with the prompt still present. The run was settled FAILED with executionLease=null before patching.`
- `RECOMMENDED_REPAIR`: `After every Generate click, require a bounded submission acknowledgment. If the native CDP dispatch produces no change, perform one same-send DOM click fallback and re-check. If still unconfirmed, fail fast with a structured submission error; never enter the long result wait.`
- `CHOSEN_REPAIR`: `Added bounded post-click acknowledgment and one same-send DOM fallback for Flow Generate. This does not increase provider retry budget and does not send scene 1.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Regression coverage for bounded Generate acknowledgment and DOM fallback.`
- `TEST_RESULTS`: `PASS — electron/flow-prompt-input.test.ts: 11/11; npm run typecheck: PASS; node --check electron/main.cjs: PASS; git diff --check: PASS.`
- `LIVE_VALIDATION`: `PASS for ISSUE-030: patched runtime selected scene 2 without resending scene 1; the first Flow unusual-activity block triggered exactly one reload/rebind/resend; the second provider block was surfaced after 9.7 seconds as FLOW_PROVIDER_UNUSUAL_ACTIVITY with recoveryAttempt=1/recoveryBudget=1. The run settled FAILED with executionLease=null; no 600-second submission wait occurred. Scene 2 remains unpersisted because the external provider created no job.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=32; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null; scene-1 video persisted.`
- `NOTES`: `Do not create a new run. Scene 1 remains skipped and persisted. The code repair is complete; the current same-run blocker is the already tracked external FLOW_PROVIDER_UNUSUAL_ACTIVITY recurrence (ISSUE-026/027), not a new application failure. Do not retry automatically or bypass Flow anti-abuse.`

### ISSUE-031

- `ISSUE_ID`: `ISSUE-031`
- `REGRESSION_OF`: `ISSUE-026 / ISSUE-027`
- `DISCOVERED_AT`: `2026-09-21T15:47:24+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `34`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 3 / project=3169d3a1-f002-4d6e-8e5d-a19fc22b15c0`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `Flow accepted the scene-3 prompt preparation and Generate interaction, then displayed “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” No scene-3 video was created or persisted.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1 and scene 2 videos were already persisted locally; the scene-3.webp source image existed; Flow project loaded; the scene-3 prompt was accepted; the pipeline reached Generate.`
- `EXPECTED_STATE`: `The scene-3 source image is bound as the Flow Start frame, the provider creates a generation job, and a video card/source becomes available.`
- `ACTUAL_STATE`: `After submission, Flow showed the provider anti-abuse block. The post-failure composer is blank and does not show an active image chip; this is expected after submission because the implementation uses Start frame selection rather than a prompt-chip attachment. The Flow page still showed scene-3.webp in the project media area, but no provider job/video existed.`
- `ROOT_CAUSE`: `The external Google Flow anti-abuse/unusual-activity restriction recurred for scene 3 after the app completed source-image/Start-frame and prompt preparation. The absence of an image chip in the post-failure composer is a UI-state observation after submission, not evidence that the source image was missing before Generate.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Same-run resume → persisted scene-1/scene-2 hydration → scene-3 slot selected → scene-3.webp uploaded and selected as Start frame → exact prompt accepted → Generate → Flow unusual-activity block → no provider job/video → run settled FAILED.`
- `RELEVANT_EVIDENCE`: `Live Flow DOM after failure contained the exact unusual-activity text, two scene-3.webp media tiles, and a blank composer. Source code calls uploadFlowAsset(..., false) followed by addFlowAssetToStart(...) and verifies the Start frame before prompt submission. Browser-actions recorded scene-3 prompt acceptance at 2026-09-21T08:46:44Z, provider block at 08:46:54Z, one bounded reload/rebind/resend, and a second provider block at 08:47:24Z. Authenticated API: run status=FAILED, attemptCount=34, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null; scene-3 video endpoint returned 404 VIDEO_NOT_FOUND. Scene-1 and scene-2 MP4 files remain present.`
- `RECOMMENDED_REPAIR`: `No retry or anti-abuse bypass. Keep the current run failed at the VIDEOS checkpoint and wait for provider recovery/manual Flow acceptance. If a future UI change is desired, expose an explicit pre-submit Start-frame verification in the progress UI; it is not the first divergence of this failure.`
- `CHOSEN_REPAIR`: `None in this run; existing structured FLOW_PROVIDER_UNUSUAL_ACTIVITY handling was preserved and the run was stopped.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — live failure recording only.`
- `TEST_RESULTS`: `Not run — no source repair was requested or required for this provider-side failure.`
- `LIVE_VALIDATION`: `PASS for diagnosis — scene 3 reproduced the provider unusual-activity block after prompt/Generate preparation; no video/job was created.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; executionLease=null; scene 1 and scene 2 remain persisted; scene 3 remains incomplete.`
- `STATUS`: `REGRESSION / EXTERNAL_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=34; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No new run, database reset, profile/cookie deletion, Stage 5 continuation, or additional Flow retry was performed. The next safe action requires provider recovery and an explicit CONTINUE.`

### ISSUE-032

- `ISSUE_ID`: `ISSUE-032`
- `REGRESSION_OF`: `ISSUE-026 / ISSUE-027 / ISSUE-031`
- `DISCOVERED_AT`: `2026-09-21T16:03:01+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `35`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 3 / project=009f0a1c-5c72-4aa9-bc31-71fd7f7ae6ae`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `The explicit user-requested retry selected the first incomplete scene, scene 3, and Flow again displayed “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” No provider job or scene-3 video was created.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1 and scene 2 remained persisted; scene-3.webp and the validated scene-3 prompt were prepared; Flow project reached the Generate action.`
- `EXPECTED_STATE`: `Flow accepts the Generate action, creates a provider job, and exposes a scene-3 video.`
- `ACTUAL_STATE`: `Provider blocked the first automated generation, the existing single reload/rebind/resend recovery was consumed, and the second automated generation was blocked with the same structured error. The run settled FAILED with executionLease=null.`
- `ROOT_CAUSE`: `Recurring external Google Flow anti-abuse/unusual-activity restriction. This is not a new source-image, prompt, or checkpoint defect.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Same-run CONTINUE → skip persisted scenes 1–2 → select scene 3 → Flow project ready → prompt accepted → provider unusual-activity block → one bounded reload/rebind/resend → second provider unusual-activity block → run settled FAILED.`
- `RELEVANT_EVIDENCE`: `browser-actions recorded scene-3 prompt acceptance at 2026-09-21T09:02:29Z, first provider block at 09:02:31Z, recoveryAttempt=1/recoveryBudget=1, resend prompt acceptance at 09:02:51Z, and second provider block at 09:03:00Z. Authenticated API after settlement: status=FAILED, attemptCount=35, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null; scene-3 video remains absent.`
- `RECOMMENDED_REPAIR`: `Do not retry again automatically. Require the provider block to clear through normal/manual Flow use before another explicit same-run continuation. Do not bypass anti-abuse, change account/profile, rotate IP, or delete cookies.`
- `CHOSEN_REPAIR`: `None; existing non-retryable provider-block handling and one-recovery budget were preserved.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — repeated live provider failure only.`
- `TEST_RESULTS`: `Not run — no source repair was requested or required.`
- `LIVE_VALIDATION`: `PASS for diagnosis — scene 3 reproduced the same provider block and stopped after the bounded recovery.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; executionLease=null; scenes 1–2 persisted; scene 3 incomplete.`
- `STATUS`: `REGRESSION / EXTERNAL_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=35; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `This was the user's explicit retry. No new run was created and scenes 1–2 were not regenerated. Further retries should wait for provider recovery/manual confirmation.`

### ISSUE-033

- `ISSUE_ID`: `ISSUE-033`
- `DISCOVERED_AT`: `2026-09-21T16:07:30+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `35`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `Flow scene 3 reference-frame preparation / project=009f0a1c-5c72-4aa9-bc31-71fd7f7ae6ae`
- `FIRST_DIVERGENCE`: `FLOW_START_FRAME_MODE_NOT_CONFIRMED`
- `SYMPTOM`: `The Flow settings UI shows Frames aria-checked=false while Ingredients aria-checked=true, even though scene-3.webp is visible in the Flow media area and the automation proceeded to prompt submission.`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow project loaded and the scene-3 source image existed in the project media library.`
- `EXPECTED_STATE`: `Before uploading/selecting the source image, the Flow Video type control is in Frames mode; after selection, the image is confirmed in the Start-frame slot.`
- `ACTUAL_STATE`: `The active Flow mode was Ingredients, not Frames. The current verification only checks for a generic image chip/media identity and does not assert the selected mode or a Start-frame-specific slot, so an ingredient attachment can be incorrectly accepted as a Start frame.`
- `ROOT_CAUSE`: `The video preparation path attempts to click Frames but has no post-click assertion that the Frames radio is selected. verifyFlowStartFrameAttachment() accepts generic ingredient/media chips and therefore can produce a false Start-frame confirmation while Ingredients remains selected.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs configureFlowVideo / addFlowAssetToStart / verifyFlowStartFrameAttachment`
- `FAILURE_CALL_CHAIN`: `Flow settings opened → Frames click attempted without selected-state assertion → Ingredients remained active → uploaded scene-3.webp was accepted by generic chip detection → prompt submitted without proven Start-frame mode.`
- `RELEVANT_EVIDENCE`: `Read-only CDP inspection of the live Flow project showed button[role=radio] “Frames” with aria-checked=false and “Ingredients” with aria-checked=true. Source lines 5631–5632 call uploadFlowAsset(..., false) then addFlowAssetToStart(); verifyFlowStartFrameAttachment() matches generic selectors including flow-image-ingredient-chip and flow-media-chip but does not inspect the Frames/Ingredients radio state or a Start-frame-specific slot.`
- `RECOMMENDED_REPAIR`: `After selecting Frames, require an explicit postcondition Frames aria-checked=true and Ingredients aria-checked=false. Then select the uploaded asset and verify a Start-frame-specific UI/state binding, not merely a generic ingredient/media chip. Fail closed before prompt submission if either condition is absent.`
- `CHOSEN_REPAIR`: `Require a post-click Frames mode postcondition (Frames=true and Ingredients=false), record the verified mode, and make Start-frame attachment verification fail closed when the mode is not Frames.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Regression tests verify the Frames/Ingredients radio postcondition and reject generic image/ingredient evidence when Frames is not active.`
- `TEST_RESULTS`: `PASS — electron/flow-prompt-input.test.ts: 13/13; npm run typecheck: PASS; node --check electron/main.cjs: PASS; git diff --check: PASS.`
- `LIVE_VALIDATION`: `PASS — same-run attempt 38 recorded flow-frames-mode-verified with Frames=true/Ingredients=false, then accepted the scene-3 prompt and reached Generate. The run's first divergence after the repaired binding path was the separate external FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY block.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=35; executionLease=null.`
- `NOTES`: `This is a separate latent reference-binding defect. The repair is source/test validated; run the same failed run again for scene 3 only. Do not regenerate scenes 1–2. If Flow again returns the external unusual-activity block, stop after the existing bounded recovery and record that provider failure separately.`

### ISSUE-034

- `ISSUE_ID`: `ISSUE-034`
- `REGRESSION_OF`: `ISSUE-026 / ISSUE-027 / ISSUE-031 / ISSUE-032`
- `DISCOVERED_AT`: `2026-09-21T18:07:13+07:00`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `38`
- `STAGE`: `4 — Tạo video phân cảnh bằng Flow Veo 3`
- `JOB/SCENE`: `automatic-pipeline / Flow video scene 3 / project=fc640a07-a4fa-41d9-acdf-c236a260af32`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `After the repaired runtime verified Frames=true and Ingredients=false, confirmed the scene-3 prompt input, and triggered Generate, Google Flow displayed “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” No provider job or scene-3 video was created.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scenes 1–2 persisted; scene-3.webp was prepared; live Flow mode verification passed; the Start-frame attachment path passed far enough for prompt submission; Generate was triggered.`
- `EXPECTED_STATE`: `Flow accepts Generate, creates a provider job, and exposes a scene-3 video.`
- `ACTUAL_STATE`: `Flow rejected the first automated generation with FLOW_PROVIDER_UNUSUAL_ACTIVITY. The existing single reload/rebind/resend recovery was consumed; the second automated send was rejected with the same provider message. The run settled FAILED with lastCompletedStage=3, resumeTarget=VIDEOS, executionLease=null; scene-3.mp4 is absent.`
- `ROOT_CAUSE`: `The external Google Flow anti-abuse/unusual-activity restriction recurred after the application-side Frames/Start-frame repair passed. This is provider-side, not the repaired scene-image binding path.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI; electron/main.cjs waitForFlowVideo`
- `FAILURE_CALL_CHAIN`: `Same-run resume → skip persisted scenes 1–2 → scene-3 Frames mode verified → scene-3.webp bound → prompt accepted → Generate → provider unusual-activity block → one bounded reload/rebind/resend → second provider block → lifecycle settlement.`
- `RELEVANT_EVIDENCE`: `browser-actions recorded flow-frames-mode-verified at 2026-09-21T11:06:22Z and again during recovery, flow-prompt-input at 11:06:46Z and 11:07:10Z, provider blocks at 11:06:48Z and 11:07:13Z, with recoveryAttempt=1/recoveryBudget=1. Authenticated run state after settlement: status=FAILED, attemptCount=38, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null. scene-3.mp4 does not exist.`
- `RECOMMENDED_REPAIR`: `No additional application retry or anti-abuse bypass. Keep the run at the VIDEOS checkpoint and require normal/manual Flow recovery before another explicit same-run continuation. Do not change account/profile, delete cookies, rotate IPs, or retry repeatedly.`
- `CHOSEN_REPAIR`: `None; the application-side ISSUE-033 repair is fixed and the remaining failure is an external provider block.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — provider recurrence only.`
- `TEST_RESULTS`: `Not run for provider-only recurrence; ISSUE-033 targeted tests/typecheck/syntax/diff checks passed.`

### ISSUE-035

- `ISSUE_ID`: `ISSUE-035`
- `REGRESSION_OF`: `ISSUE-034`
- `DISCOVERED_AT`: `2026-09-22T01:18:00Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `38`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 / cmuagw9cy0005k580qga9dz1s`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `The app completed Flow configuration, bound the Scene 4 start frame, submitted Generate, reloaded and resent once under the bounded recovery policy, then Flow again returned FLOW_PROVIDER_UNUSUAL_ACTIVITY.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scenes 1 and 2 were already stored in the application. Scene 3 was downloaded from Flow and copied into the application canonical media store at generated-videos/cmuagw9cx0001k5806rv7o518/scene-3.mp4 with a matching SHA-256 hash. Stage 4 then addressed only Scene 4.`
- `EXPECTED_STATE`: `Flow accepts Scene 4 and produces a completed video which the app can download and persist.`
- `ACTUAL_STATE`: `No completed provider video was returned for Scene 4 after the one permitted reload/resend.`
- `ROOT_CAUSE`: `Google Flow provider anti-abuse control rejected the Scene 4 generation after a valid application-side submission path. This is external provider state, not a missing local file, prompt-fidelity, reference-binding, or download failure.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider generation result`
- `FAILURE_CALL_CHAIN`: `Stage 4 Scene 4 → Prompt Fidelity PASS → start frame upload/bind PASS → Generate → provider unusual-activity state → bounded reload/resend → provider unusual-activity state → terminal structured failure.`
- `RELEVANT_EVIDENCE`: `Progress captured the Flow project creation, start-frame upload, initial Generate, exactly one recovery reload/resend, and terminal FLOW_PROVIDER_UNUSUAL_ACTIVITY. No additional retry was issued.`
- `RECOMMENDED_REPAIR`: `Do not bypass provider controls or increase retries. Let the account/provider block clear, then have the user perform one manual Flow generation for Scene 4 or explicitly resume after Flow accepts normal generation.`
- `CHOSEN_REPAIR`: `None — external provider block; automated retries stopped after the existing one-retry budget.`
- `FILES_CHANGED`: `generated-videos/cmuagw9cx0001k5806rv7o518/scene-3.mp4; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TEST_RESULTS`: `Scene 3 SHA-256 source/destination match PASS. Stage 4 preflight/PROMPT_FIDELITY PASS for Scene 4.`
- `LIVE_VALIDATION`: `FAIL for Scene 4 only: provider block surfaced after bounded retry.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `Stage 4 / VIDEOS; Scenes 1–3 preserved; Scene 4 incomplete.`
- `NOTES`: `No database reset, account change, cookie deletion, proxy/IP change, or anti-abuse bypass was performed.`
- `LIVE_VALIDATION`: `PASS for diagnosis — the repaired path reached prompt submission with Frames mode verified, then reproduced the provider block and stopped after the bounded recovery.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; executionLease=null; scenes 1–2 remain persisted; scene 3 remains incomplete.`
- `STATUS`: `REGRESSION / EXTERNAL_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attemptCount=38; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `No new run was created. Do not run Stage 5. Another continuation requires provider recovery/manual confirmation.`

### ISSUE-036

- `ISSUE_ID`: `ISSUE-036`
- `DISCOVERED_AT`: `2026-09-22T01:55:20Z`
- `RUN_ID`: `cmu8ao66q004ak5jco5mgvf4w`
- `ATTEMPT`: `39`
- `STAGE`: `5 — Ghép và xuất video hoàn chỉnh`
- `JOB/SCENE`: `final-video assembly / project=cmuagw9cx0001k5806rv7o518`
- `FIRST_DIVERGENCE`: `FINAL_VIDEO_PROCESSOR_UNAVAILABLE`
- `SYMPTOM`: `The user-created Scene 4 video was downloaded, persisted through the manual Flow checkpoint, and Stage 4 completed with all four scene videos. The canonical resume then entered final assembly and failed with “Không xuất được video hoàn chỉnh.”`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1–4 video endpoints were available from the canonical app store; the run reported the videos step as completed with detail “Đã tạo 4 video phân cảnh.”`
- `EXPECTED_STATE`: `The final-video renderer finds a usable video processor, assembles the four persisted scene videos, and stores final.mp4.`
- `ACTUAL_STATE`: `The Electron video-editor:render-final handler failed before assembly because findFfmpegPath could not find a video processor. The run settled FAILED with lastCompletedStage=4, failedStage=5, resumeTarget=FINAL_VIDEO, and executionLease=null.`
- `ROOT_CAUSE`: `The current recovery runtime has no discoverable FFmpeg/video-processing runtime for final assembly. This is an application runtime dependency/configuration failure, not a missing Scene 4 asset.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs findFfmpegPath:3173 → runFfmpeg:3177 → readMediaDuration:3199 → renderFinalVideo:3259`
- `FAILURE_CALL_CHAIN`: `Same-run CONTINUE → persisted scenes 1–4 hydrated → Stage 4 completed → final-video render invoked → video-editor:render-final → findFfmpegPath threw “Chưa tìm thấy bộ xử lý video. Hãy cài CapCut hoặc liên hệ hỗ trợ để cài runtime video.” → run settled FAILED.`
- `RELEVANT_EVIDENCE`: `recovery-desktop-runtime.err.log records the exact handler error and stack at electron/main.cjs:3173. Authenticated AutomationRun readback: status=FAILED, lastCompletedStage=4, failedStage=5, resumeTarget=FINAL_VIDEO, attemptCount=39, error=“Không xuất được video hoàn chỉnh.”, executionLease=null. Stage steps report modeling-idea/content-project/images/videos completed and final-video failed.`
- `RECOMMENDED_REPAIR`: `Install or correctly bind the repository-supported FFmpeg/video-processing runtime in the current Electron runtime, verify findFfmpegPath resolves it, then run a focused final-assembly validation using the existing four scene files. Do not regenerate scenes or reset the database.`
- `CHOSEN_REPAIR`: `Bound the current Electron runtime to a valid repository-supported ffmpeg-static 5.3.0 Windows binary through MODELING_AI_FFMPEG_PATH, then resumed the existing run at FINAL_VIDEO without regenerating scenes.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — live final-assembly validation was the targeted check for this runtime dependency incident.`
- `TEST_RESULTS`: `PASS — same run attempt 41 completed Stage 5; persisted final.mp4 is 6,652,527 bytes, SHA-256 9D680D0BCAFA79DC52614A5095F0DFD561D9A8BB0CE4C3E720F178A882AACB61, duration 15.14s, H.264/AAC, 720x1280.`
- `LIVE_VALIDATION`: `PASS — Electron main and renderer were launched from the recovery worktree, the four persisted scene files were hydrated from AppData, ffmpeg resolved from C:\\Users\\Admin\\AppData\\Local\\Temp\\modeling-ai-stage5-ffmpeg-5.3.0\\ffmpeg.exe, and the app persisted final.mp4. No scene was regenerated.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=SUCCEEDED; lastCompletedStage=5; failedStage=null; resumeTarget=null; attemptCount=41; contentProjectId=cmuagw9cx0001k5806rv7o518; executionLease=null.`
- `NOTES`: `Stage 5 completed. Release v1.0.5 verified the permanent packaged-runtime binding: electron/dist/ffmpeg/ffmpeg.exe and the unpacked installer binary both execute successfully and have SHA-256 04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00. The database, browser profile, .env, and historical scene files were not changed.`

## RELEASE v1.0.5

- `RELEASE_CANDIDATE_READY`: `YES`
- `FINAL_VIDEO`: `PASS — Stage 1–5 succeeded; final.mp4 validated as H.264/AAC 720x1280, 15.14s.`
- `FULL_REGRESSION`: `PASS — 79 test files, 862 tests; typecheck PASS; lint 0 errors (warnings only); syntax and diff checks PASS.`
- `PACKAGING`: `PASS — Modeling.AI.Setup.1.0.5.exe; FFmpeg packaged and runtime-validated; latest.yml generated.`
- `DATA_INTEGRITY`: `PASS — no database reset/destructive migration; AppData, generated assets, browser profiles, and .env preserved.`
- `KNOWN_EXTERNAL_LIMITATION`: `Google Flow unusual-activity remains an external provider decision; the application handles it as non-retryable and does not bypass anti-abuse controls.`

### ISSUE-037

- `ISSUE_ID`: `ISSUE-037`
- `STAGE`: `Release packaging / installed-app startup`
- `FIRST_DIVERGENCE`: `PACKAGED_MAIN_MODULE_MISSING`
- `SYMPTOM`: `The v1.0.5 installed application stopped at startup with Cannot find module './temp-cleanup.cjs'.`
- `ROOT_CAUSE`: `The Electron build.files allowlist omitted temp-cleanup.cjs, ipc-contract.cjs, and dev-runtime-identity.cjs even though electron/main.cjs requires all three.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `CHOSEN_REPAIR`: `Add all three helper modules to build.files and add a clean-install archive preflight that rejects any package missing a required main-process helper.`
- `TEST_RESULTS`: `PASS — package contract test 2/2; typecheck PASS; lint 0 errors; app.asar inspection confirms all required modules; clean-install smoke PASS with an isolated temporary userData directory.`
- `STATUS`: `FIXED`

### ISSUE-038

- `ISSUE_ID`: `ISSUE-038`
- `DISCOVERED_AT`: `2026-09-22T04:58:00Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `2`
- `STAGE`: `3 — Tạo ảnh phân cảnh bằng Google Flow`
- `JOB/SCENE`: `background image / Flow project=cf9458d1-5b5c-4672-9cc2-bc723ef6df1d`
- `FIRST_DIVERGENCE`: `FLOW_ASSET_PICKER_SELECTOR_MISMATCH`
- `SYMPTOM`: `The Flow project contained the requested source asset, but the automation reported that the exact reference image could not be found.`
- `LAST_CONFIRMED_GOOD_STATE`: `Flow project opened and the source image was visible in the current project media UI.`
- `EXPECTED_STATE`: `The asset picker identifies the exact asset and binds it before prompt submission.`
- `ACTUAL_STATE`: `The current Flow UI rendered the picker inside a CDK overlay with role=option tiles, while the old selector set only searched the previous popover container and text-only candidates.`
- `ROOT_CAUSE`: `The asset-picker locator did not cover the current Flow overlay/role=option DOM contract and could not match asset identity by aria-label/title.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs findFlowAssetPoint / asset-picker selection`
- `RECOMMENDED_REPAIR`: `Support the current overlay containers and role=option asset tiles; match stable accessible identity attributes, then fail closed if the exact asset is absent.`
- `CHOSEN_REPAIR`: `Added CDK overlay/dialog and role=option selectors plus aria-label/title/text identity matching.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts`
- `TESTS_ADDED`: `Regression contract for current Flow overlay and role=option asset selection.`
- `TEST_RESULTS`: `PASS — electron/flow-prompt-input.test.ts 16/16; npm run typecheck PASS; node --check electron/main.cjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — the exact reference asset was found/bound in the live Flow project after the locator repair.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Same run remains at Stage 3 image generation; no new run created.`

### ISSUE-039

- `ISSUE_ID`: `ISSUE-039`
- `REGRESSION_OF`: `ISSUE-038`
- `DISCOVERED_AT`: `2026-09-22T05:00:00Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `2`
- `STAGE`: `3 — Tạo ảnh phân cảnh bằng Google Flow`
- `JOB/SCENE`: `background image retrieval / Flow project=cf9458d1-5b5c-4672-9cc2-bc723ef6df1d`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_RESPONSE_CAPTURE_SOURCE_STALE`
- `SYMPTOM`: `Flow accepted the image generation action, but the app waited on a stale flow-content image URL and timed out instead of reading the current image source exposed by the live page.`
- `LAST_CONFIRMED_GOOD_STATE`: `The exact asset was bound, prompt was accepted, and Flow exposed a generated image in the live DOM.`
- `EXPECTED_STATE`: `The app captures the current generated image through the native CDP path and persists it.`
- `ACTUAL_STATE`: `The first response source was a transient/stale flow-content URL; page-context fetch was not a reliable capture path because of cross-origin restrictions.`
- `ROOT_CAUSE`: `Image retrieval did not prioritize current live DOM media sources and native CDP capture before attempting the stale candidate URL.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs getFlowImageBuffer / readFlowMediaBufferThroughCdp`
- `RECOMMENDED_REPAIR`: `Collect current live DOM image sources and attempt native CDP media capture first, while retaining the existing candidate fallback.`
- `CHOSEN_REPAIR`: `Prioritized live DOM sources and native CDP image capture before the fallback candidate reader.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts`
- `TESTS_ADDED`: `Regression contract requiring live-source CDP capture before stale candidate fallback.`
- `TEST_RESULTS`: `PASS — electron/flow-prompt-input.test.ts 16/16; npm run typecheck PASS; node --check electron/main.cjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS for application-side capture path — the run advanced to the provider response stage; the remaining failure was the separate external provider block recorded below.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Same run remains at Stage 3 image generation; no new run created.`

### ISSUE-040

- `ISSUE_ID`: `ISSUE-040`
- `REGRESSION_OF`: `ISSUE-026 / ISSUE-038 / ISSUE-039`
- `DISCOVERED_AT`: `2026-09-22T05:01:22.283Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `3`
- `STAGE`: `3 — Tạo ảnh phân cảnh bằng Google Flow`
- `JOB/SCENE`: `background image generation / Flow project=cf9458d1-5b5c-4672-9cc2-bc723ef6df1d`
- `FIRST_DIVERGENCE`: `FLOW_IMAGE_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `After the repaired runtime found the exact source asset, accepted the validated prompt, and triggered Generate, Google Flow displayed “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.”`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 1 and Stage 2 were persisted; the Flow project opened; source binding and prompt submission completed through the current-worktree Electron/CDP runtime.`
- `EXPECTED_STATE`: `Flow creates an image job/result and the app persists the background plus four scene images.`
- `ACTUAL_STATE`: `The provider rejected Generate before creating a provider job or starting generation. The existing one bounded reload/rebind/resend recovery was consumed; the run was settled as FAILED with executionLease=null. Stage 3 is incomplete and Stage 4/5 were not started.`
- `ROOT_CAUSE`: `Google Flow external anti-abuse/unusual-activity restriction. The application-side asset-picker and image-capture repairs passed before the provider rejected the generation.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider UI / electron/main.cjs image-generation wait path`
- `FAILURE_CALL_CHAIN`: `Same-run Stage 3 → current-worktree CDP runtime → Flow project ready → exact asset bound → prompt accepted → Generate → provider unusual-activity block → bounded reload/rebind/resend → provider block remained → structured failure persisted.`
- `RELEVANT_EVIDENCE`: `Live Flow DOM showed the exact provider message; generationStarted=false; providerJobCreated=false; browser remained authenticated; authenticated run patch readback shows status=FAILED, lastCompletedStage=2, failedStage=3, resumeTarget=IMAGES, attemptCount=3, executionLease=null, failureCode=FLOW_PROVIDER_UNUSUAL_ACTIVITY, autoRetryAllowed=false.`
- `RECOMMENDED_REPAIR`: `No further code retry and no anti-abuse bypass. Keep the same run paused at IMAGES; allow normal/manual provider recovery, then require an explicit CONTINUE. Do not rotate account/profile/IP, spoof the browser, or delete cookies.`
- `CHOSEN_REPAIR`: `None — this is an external provider blocker. The repaired application path is preserved and further automatic retries are disabled.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `ISSUE-038/039 source-contract regressions.`
- `TEST_RESULTS`: `PASS — 16/16 targeted tests; typecheck PASS; syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS for diagnosis and failure classification; FAIL for full Stage 3 because Google Flow blocked the provider operation before job creation.`
- `STRUCTURED_PROVIDER_ERROR`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_3_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=2; resumeTarget=IMAGES; executionLease=null; Stage 3 incomplete.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=2; failedStage=3; resumeTarget=IMAGES; attemptCount=3; contentProjectId=cmuc5pkc7000kk5ycb2lg2ksz; executionLease=null.`
- `NOTES`: `No new AutomationRun, database reset, account/profile change, cookie deletion, IP/proxy rotation, anti-abuse bypass, Stage 4 continuation, or Stage 5 continuation was performed.`

## RELEASE v1.0.6

- `RELEASE_CANDIDATE_READY`: `YES`
- `PACKAGING`: `PASS — Modeling.AI.Setup.1.0.6.exe, latest.yml and blockmap generated.`
- `CLEAN_INSTALL_SMOKE`: `PASS — isolated startup and restart completed without accessing production AppData.`
- `PACKAGED_MAIN_MODULES`: `PASS — main.cjs, user-data.cjs, temp-cleanup.cjs, ipc-contract.cjs, dev-runtime-identity.cjs, and gemini-error-transport.cjs are present in app.asar.`

### ISSUE-041

- `ISSUE_ID`: `ISSUE-041`
- `DISCOVERED_AT`: `2026-09-22T07:03:08Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `3`
- `STAGE`: `3 — IMAGE GENERATION`
- `FIRST_DIVERGENCE`: `STAGE_3_PROVIDER_DESIGN_MISMATCH`
- `SYMPTOM`: `Stage 3 used Google Flow for image generation, exposing image creation to Flow's external unusual-activity block before the video-only stage.`
- `EXPECTED_STATE`: `Stage 3 creates the background and four scene reference images through Gemini; Google Flow is used only for Stage 4 video generation.`
- `ROOT_CAUSE`: `The Stage 3 implementation selected the video provider for an image-generation responsibility, contrary to the revised workflow boundary.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `CHOSEN_REPAIR`: `Route Stage 3 slot generation through the existing Gemini CDP job bridge; retain Google Flow exclusively in Stage 4. Add a direct bare Gemini /app composer-ready path and a development FFmpeg fallback needed by the Gemini image crop path.`
- `FILES_CHANGED`: `src/components/viral-dashboard.tsx; src/components/viral-dashboard.ui.test.ts; electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Stage-3 provider contract regression; bare Gemini composer-ready regression; development FFmpeg discovery regression.`
- `TEST_RESULTS`: `PASS — 36 targeted tests; npm run typecheck PASS; node --check electron/main.cjs PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `PASS — Gemini CDP created and persisted background-0.png plus scene-1.png through scene-4.png (five non-empty image files) in the canonical app store. Flow was not called during Stage 3.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=PAUSED; lastCompletedStage=3; failedStage=null; resumeTarget=null; executionLease=null; videos/final-video remain pending.`
- `NOTES`: `The prior Flow provider block remains historical evidence only. Stage 4 will use Flow only when explicitly requested; it was not started by this repair.`

### ISSUE-042

- `ISSUE_ID`: `ISSUE-042`
- `DISCOVERED_AT`: `2026-09-22T07:14:47Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `4`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 1`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `Flow accepted the application-side setup for Scene 1, including its Gemini-created start frame and a submitted Generate action, but displayed its unusual-activity provider block.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stages 1–3 were complete; five Gemini images were persisted. Flow opened its project, configured video mode, and attached scene-1.png as the Start frame.`
- `EXPECTED_STATE`: `Flow creates a provider video job for Scene 1, then the application downloads, verifies, and persists scene-1.mp4 before proceeding.`
- `ACTUAL_STATE`: `The initial Generate did not yield a provider job. The existing bounded recovery reloaded the Flow project, rebound the reference image, and sent the same request once more. Flow again returned unusual activity; generationStarted=false and providerJobCreated=false.`
- `ROOT_CAUSE`: `Google Flow's provider anti-abuse system rejected the generation operation after a valid local application path.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider result after bounded reload/resend recovery.`
- `FAILURE_CALL_CHAIN`: `Stage 4 → Scene 1 image-reference binding PASS → Generate → Flow unusual-activity block → one reload/rebind/resend → Flow unusual-activity block → settled failed checkpoint.`
- `RELEVANT_EVIDENCE`: `Live CDP progress recorded Flow opening, video configuration, scene-1.png upload/reference binding, initial submission, exactly one reload/resend, and terminal provider message. The user screenshot also shows the Flow project with scene-1.png attached.`
- `RECOMMENDED_REPAIR`: `Do not bypass Flow controls or exceed the one-recovery retry budget. Let the user confirm that manual Flow generation is accepted normally, then resume this same run from VIDEOS; the app will preserve Stage 3 and not recreate images.`
- `CHOSEN_REPAIR`: `No code patch. The structured non-retryable provider-block handling and Stage 4 checkpoint settlement were applied.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — external provider recurrence.`
- `TEST_RESULTS`: `Checkpoint persistence PASS — status=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; executionLease=null.`
- `LIVE_VALIDATION`: `Application setup PASS; provider generation FAIL after the one permitted reload/resend.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `Same run, Stage 4 / VIDEOS; Scene 1 incomplete; Stages 1–3 retained; Stage 5 pending.`
- `NOTES`: `No third automatic submission was sent. No account/profile/IP/cookie change or anti-abuse bypass was performed.`

### ISSUE-043

- `ISSUE_ID`: `ISSUE-043`
- `REGRESSION_OF`: `ISSUE-042`
- `DISCOVERED_AT`: `2026-09-22T07:26:10Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `5`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 2`
- `FIRST_DIVERGENCE`: `FLOW_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `The repaired retry path waited longer after reload, but Flow still blocked Scene 2. The second-send branch also needed to preserve the structured provider error instead of returning the generic video-failure message.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1 was manually completed and persisted as scene-1.mp4; Stages 1–3 remained complete.`
- `EXPECTED_STATE`: `After the one bounded reload/rebind/resend, Flow either returns a video or the structured provider block is surfaced and the checkpoint settles.`
- `ACTUAL_STATE`: `Flow again returned no provider job after the bounded resend. The run was settled with Scene 1 preserved and Scene 2 incomplete.`
- `ROOT_CAUSE`: `External Flow anti-abuse state remained active for the automated Scene 2 operation; the application also had a generic fallback on the post-recovery failed-state branch.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `CHOSEN_REPAIR`: `Increase the post-reload stabilization window to 10 seconds, suppress stale provider-banner detection only during that bounded window, and reconstruct FLOW_PROVIDER_UNUSUAL_ACTIVITY when the post-recovery state still carries the provider block.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Recovery-settle and structured post-recovery provider-error regression.`
- `TEST_RESULTS`: `PASS — 19/19 targeted Flow tests; typecheck PASS; syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `Application retry path executed with the new wait; provider still blocked Scene 2. No third retry was attempted.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `runStatus=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; executionLease=null; Scene 1 persisted; Scenes 2–4 incomplete.`
- `NOTES`: `No account/profile/IP/cookie change or anti-abuse bypass was performed.`

### ISSUE-044

- `ISSUE_ID`: `ISSUE-044`
- `REGRESSION_OF`: `ISSUE-043`
- `DISCOVERED_AT`: `2026-09-22T15:06:27+07:00`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `7`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 3 pacing hardening`
- `FIRST_DIVERGENCE`: `FLOW_INTERACTION_CADENCE_TOO_FAST (SUSPECTED)`
- `SYMPTOM`: `The provider block persisted after the prior bounded recovery. The user reported that manual reload-and-send succeeds and requested slower, human-paced Flow interactions.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 2 was manually completed and persisted at the canonical application video path.`
- `EXPECTED_STATE`: `Flow transitions are separated by observable UI waits before upload, prompt entry, and Generate; retry budget remains one.`
- `ACTUAL_STATE`: `Pacing repair was applied and exercised live for Scene 3. Flow completed the application-side setup, but after the paced send and the existing one bounded reload/rebind/resend it again returned the unusual-activity block before creating a provider job.`
- `ROOT_CAUSE`: `Rapid application-side Flow action cadence is a user-reported contributing-factor hypothesis; Google provider anti-abuse remains the confirmed external blocker and this hypothesis is not yet proven.`
- `ROOT_CAUSE_CONFIDENCE`: `PROVISIONAL`
- `RECOMMENDED_REPAIR`: `Use bounded human-paced waits at Flow control, upload, prompt, escape, and pre-Generate boundaries without changing retry or account behavior.`
- `CHOSEN_REPAIR`: `Added explicit Flow pacing constants and boundary waits; preserved MAX_FLOW_PROVIDER_RELOAD_RECOVERY=1 and no anti-abuse bypass.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md`
- `TESTS_ADDED`: `Flow human-paced interaction contract.`
- `TEST_RESULTS`: `PASS — 20/20 targeted Flow tests; typecheck PASS; syntax PASS; git diff --check PASS.`
- `LIVE_VALIDATION`: `FAIL for Scene 3 provider generation; PASS for application-side pacing, exact scene-3 image binding, structured provider-block detection, one bounded recovery, and safe settlement. generationStarted=false; providerJobCreated=false; no third submission was attempted.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `Same run; status=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attempt=7; completedVideoScenes=[1,2]; stage4Scene=3; executionLease=null; AUTO_RETRY_ALLOWED=NO.`
- `NOTES`: `The slower interaction repair did not clear the provider block. No account/profile/IP/cookie change, anti-abuse bypass, database reset, or Stage 5 continuation was performed.`

### ISSUE-045

- `ISSUE_ID`: `ISSUE-045`
- `REGRESSION_OF`: `ISSUE-044`
- `DISCOVERED_AT`: `2026-09-22T08:34:28.928Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `8`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `Scene 3 was manually generated, captured, persisted and acknowledged by the app. The paced automated Scene 4 flow completed project setup, reference-image binding and Generate, then Flow returned its unusual-activity message after the bounded recovery.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stages 1–3 complete; scene-1.mp4, scene-2.mp4 and scene-3.mp4 are present in the canonical app video store; Flow accepted the Scene 4 setup.`
- `EXPECTED_STATE`: `Flow creates a provider job for Scene 4, after which the app downloads and verifies scene-4.mp4.`
- `ACTUAL_STATE`: `generationStarted=false and providerJobCreated=false. Flow returned “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.” The one bounded recovery was consumed; no third submission was made.`
- `ROOT_CAUSE`: `Google Flow provider anti-abuse restriction remains active for the automated video-generation operation. This is not an upload/reference-image failure.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `RECOMMENDED_REPAIR`: `Do not bypass or increase retries. Keep the same run paused at Scene 4; perform one normal/manual Flow generation when the provider accepts the account again, then import the result through the existing manual checkpoint.`
- `CHOSEN_REPAIR`: `No provider-bypass patch. The human-paced interaction path was exercised; structured provider-block settlement was corrected so the primary error is preserved.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json; .tmp-capture-manual-scene3.cjs; .tmp-save-manual-scene3.cjs; .tmp-run-scene3.cjs; .tmp-settle-stage4-provider-block.cjs`
- `TESTS_ADDED`: `None for the external provider block; existing 20/20 Flow tests remain PASS.`
- `TEST_RESULTS`: `PASS — Scene 3 manual checkpoint/import; typecheck and prior targeted pacing tests PASS. Scene 4 provider generation FAIL.`
- `LIVE_VALIDATION`: `FAIL at provider generation; application-side setup and safe one-recovery handling PASS.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `status=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; attempt=8; completedVideoScenes=[1,2,3]; stage4Scene=4; executionLease=null; AUTO_RETRY_ALLOWED=NO.`
- `NOTES`: `No account/profile/IP/cookie change, anti-abuse bypass, database reset, or Stage 5 continuation was performed.`

### ISSUE-046

- `ISSUE_ID`: `ISSUE-046`
- `REGRESSION_OF`: `None — new Gemini Veo API route for the same Stage-4 checkpoint.`
- `DISCOVERED_AT`: `2026-09-22T09:17:01.677Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `9`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 — Gemini Veo API enqueue`
- `FIRST_DIVERGENCE`: `GEMINI_VEO_API_CREDENTIAL_MISSING`
- `SYMPTOM`: `The run was resumed at the preserved Stage-4 Scene-4 checkpoint with provider=gemini. The application rejected the request before creating a background job and returned API_PROVIDER_UNAVAILABLE: Chưa kết nối Veo/Google Video API; có thể dùng Flow fallback.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stages 1–3 are complete; scene-1.mp4, scene-2.mp4 and scene-3.mp4 exist in the canonical generated-video store; the same run checkpoint had completedVideoScenes=[1,2,3] and executionLease=null before this attempt.`
- `EXPECTED_STATE`: `The Gemini Veo API route validates an active VEO or GEMINI video-generation connection, enqueues exactly one Scene-4 job, then the worker creates and persists scene-4.mp4.`
- `ACTUAL_STATE`: `GET /api/v1/ai-connections returned only one active FACEBOOK/PLATFORM connection. No active GEMINI or VEO connection existed for VIDEO_GENERATION, so no queueJobId was created, generationStarted=false, providerJobCreated=false, and no provider request was sent.`
- `ROOT_CAUSE`: `The Gemini Veo API route has no active VEO/GEMINI video-generation credential configured for the authenticated user. This is confirmed by the provider connection inventory and the route's requireProviderApiKey guard.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `src/modules/generation/google-api-pipeline.ts — enqueueProjectVideosWithVeoApi() provider credential guard.`
- `FAILURE_CALL_CHAIN`: `Same-run Stage 4 resume → provider=gemini POST /api/v1/projects/{projectId}/videos → requireProviderApiKey(VEO,GEMINI,VIDEO_GENERATION) → API_PROVIDER_UNAVAILABLE → no background job → run settled FAILED.`
- `RELEVANT_EVIDENCE`: `HTTP 503 response code API_PROVIDER_UNAVAILABLE; authenticated /api/v1/ai-connections response contained only FACEBOOK/PLATFORM with no GEMINI/VEO entry; run readback status=FAILED, attemptCount=9, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null; checkpoint completedVideoScenes=[1,2,3].`
- `RECOMMENDED_REPAIR`: `Add and verify one active VEO or GEMINI video-generation connection in the app's AI settings for this account, without exposing or logging the key. Then issue an explicit CONTINUE for the same run; do not retry the failed enqueue until the connection inventory confirms the credential.`
- `CHOSEN_REPAIR`: `None — this run turn only performed the requested execution and safe settlement. No credential was created or changed automatically.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — provider credential/configuration blocker discovered at runtime.`
- `TEST_RESULTS`: `Not applicable for this execution-only failure; the provider guard and authenticated connection inventory were read and matched.`
- `LIVE_VALIDATION`: `FAIL before job creation; no Gemini Veo generation request was sent.`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; completedVideoScenes=[1,2,3]; executionLease=null; Scene 4 remains incomplete.`
- `STATUS`: `OPEN — CONFIGURATION_CREDENTIAL_MISSING`
- `RESUME_CHECKPOINT`: `Same run; attempt=9; status=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; stage4Provider=GEMINI_VEO_API; executionLease=null.`
- `NOTES`: `No Flow request, no Gemini Veo provider request, no retry, no account/profile/cookie/IP change, no database reset, and no Stage 5 continuation were performed.`

### ISSUE-047

- `ISSUE_ID`: `ISSUE-047`
- `REGRESSION_OF`: `ISSUE-045`
- `DISCOVERED_AT`: `2026-09-22T09:27:47.067Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `10`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 — Google Flow via Electron/CDP`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `The same-run Stage-4 Scene-4 job was sent through the browser/CDP Flow path without an API key. Flow completed application-side project setup, reference binding and Generate submission, then returned “We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.”`
- `LAST_CONFIRMED_GOOD_STATE`: `Stages 1–3 are complete and scene-1.mp4, scene-2.mp4 and scene-3.mp4 remain present in the canonical app video store. The Flow queue job was claimed by the current-worktree Electron/CDP bridge.`
- `EXPECTED_STATE`: `Flow creates a provider video job for Scene 4, the app captures the result, validates it and persists scene-4.mp4.`
- `ACTUAL_STATE`: `Flow provider generationStarted=false and providerJobCreated=false. The application queue job failed with structured FLOW_PROVIDER_UNUSUAL_ACTIVITY after the existing one bounded reload/rebind/resend recovery; no video file was persisted.`
- `ROOT_CAUSE`: `Google Flow's external anti-abuse/unusual-activity system rejected the Scene-4 generation after the browser/CDP path successfully completed local setup and submission.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `Google Flow provider result in electron/main.cjs waitForFlowVideoWithRecovery() after the bounded recovery.`
- `FAILURE_CALL_CHAIN`: `Same-run resume → provider=flow POST /api/v1/projects/{projectId}/videos → desktop.flow.videos queue → Electron/CDP bridge claim → Flow setup/upload/start-frame/prompt/Generate → provider unusual-activity block → one bounded recovery → provider block remains → queue failed → run settled FAILED.`
- `RELEVANT_EVIDENCE`: `Queue status endpoint returned status=failed, provider=flow-browser, error=FLOW_PROVIDER_UNUSUAL_ACTIVITY; run readback status=FAILED, attemptCount=10, lastCompletedStage=3, failedStage=4, resumeTarget=VIDEOS, executionLease=null; generationStarted=false; providerJobCreated=false; completedVideoScenes=[1,2,3].`
- `RECOMMENDED_REPAIR`: `Do not retry automatically or bypass Flow anti-abuse controls. Use a normal/manual Flow generation when the provider accepts the account, then import the confirmed Scene-4 result through the existing manual checkpoint; otherwise keep this run paused.`
- `CHOSEN_REPAIR`: `None — this execution turn only used the CDP route and safely settled the failure. No account/profile/IP/cookie change or provider-bypass patch was made.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — external provider blocker reproduced through the existing CDP path.`
- `TEST_RESULTS`: `CDP execution reached Flow, claim and submission; provider generation failed before job creation.`
- `LIVE_VALIDATION`: `FAIL at Flow provider generation; local CDP setup and one bounded recovery were exercised.`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; completedVideoScenes=[1,2,3]; executionLease=null; Scene 4 remains incomplete.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `Same run; attempt=10; status=FAILED; lastCompletedStage=3; failedStage=4; resumeTarget=VIDEOS; stage4Provider=GOOGLE_FLOW_CDP; executionLease=null.`
- `NOTES`: `The missing Gemini/Veo API credential was not involved in this attempt. No API request was made. No third automatic submission, Stage 5 continuation, database reset, account/profile change or anti-abuse bypass was performed.`

### ISSUE-048

- `ISSUE_ID`: `ISSUE-048`
- `DISCOVERED_AT`: `2026-09-22T16:44:13+07:00`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `10`
- `STAGE`: `4 — VIDEO GENERATION ROUTING`
- `FIRST_DIVERGENCE`: `GEMINI_VIDEO_PROVIDER_NOT_CDP`
- `SYMPTOM`: `The Gemini video option was routed to the Veo API enqueue path, while the requested browser workflow requires Electron/CDP interaction.`
- `LAST_CONFIRMED_GOOD_STATE`: `The existing Flow browser bridge and Electron/CDP video executor are available and already used by the Flow route.`
- `EXPECTED_STATE`: `Selecting Gemini for video generation enqueues a browser bridge job marked gemini-cdp; Electron claims that job and performs the generation through the CDP-controlled browser.`
- `ACTUAL_STATE`: `The Gemini selection called enqueueProjectVideosWithVeoApi(), requiring a configured Veo/Gemini API connection before any browser action.`
- `ROOT_CAUSE`: `The provider-selection branch still pointed Gemini to the legacy Veo API implementation instead of the existing Electron/CDP bridge.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `RECOMMENDED_REPAIR`: `Route Gemini video selection through enqueueBrowserFlowJob with an explicit gemini-cdp provider marker; keep the legacy API worker separate and do not use it for this UI option.`
- `CHOSEN_REPAIR`: `Moved the Gemini video POST branch to the desktop.flow.videos CDP queue, persisted gemini-cdp in the bridge payload, added provider reporting as gemini-browser-cdp, updated UI/status text, and fixed the direct Gemini video IPC contract to include channelId.`
- `FILES_CHANGED`: `src/app/api/v1/projects/[id]/videos/route.ts; src/modules/generation/browser-flow-bridge.ts; src/components/viral-dashboard.tsx; src/components/viral-dashboard.ui.test.ts; src/modules/generation/video-provider-routing.test.ts; electron/preload.cjs`
- `TESTS_ADDED`: `Gemini provider route must use CDP bridge; bridge provider marker persistence; channel-aware Gemini video IPC contract.`
- `TEST_RESULTS`: `PASS — targeted provider/UI tests 26/26; npm run typecheck PASS; Electron syntax checks PASS; git diff --check PASS; npm run build PASS.`
- `LIVE_VALIDATION`: `Not run — this was a routing/code repair only; the active production run remains settled at the existing Stage-4 external provider checkpoint.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `Existing ISSUE-047 remains active: runStatus=FAILED; lastCompletedStage=3; resumeTarget=VIDEOS; executionLease=null; readyToContinue=false.`
- `NOTES`: `This repair removes the Gemini Veo API credential dependency from the Gemini UI video route. It does not bypass or clear the separate Google Flow provider unusual-activity block.`

### ISSUE-049

- `ISSUE_ID`: `ISSUE-049`
- `REGRESSION_OF`: `ISSUE-047`
- `DISCOVERED_AT`: `2026-09-22T11:01:50.845Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `11`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 — Gemini browser route through Electron/CDP`
- `FIRST_DIVERGENCE`: `FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK`
- `SYMPTOM`: `The Gemini browser/CDP queue accepted Scene 4, Electron performed the Flow UI setup, reference binding and Generate action, but the provider returned the unusual-activity block before creating a generation job.`
- `LAST_CONFIRMED_GOOD_STATE`: `Scene 1–3 MP4 files remained persisted; the same run checkpoint was resumable with executionLease=null.`
- `EXPECTED_STATE`: `The Gemini-selected CDP job creates and downloads Scene 4, verifies a non-empty MP4 and persists it without changing completed scenes.`
- `ACTUAL_STATE`: `Queue eba4c3e5-995a-4ee4-9b97-b57223dfdae1 completed as failed with FLOW_PROVIDER_UNUSUAL_ACTIVITY; generationStarted=false, providerJobCreated=false, recoveryAttempt=1/1, and no Scene 4 file was persisted.`
- `ROOT_CAUSE`: `The external Google Flow anti-abuse/unusual-activity system still rejected the browser generation. The Gemini selection correctly used the CDP bridge, but the current Electron CDP video executor operates the Google Flow UI, so the provider-level block remains.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs — waitForFlowVideoWithRecovery() after the bounded reload/rebind/resend recovery.`
- `FAILURE_CALL_CHAIN`: `Same run continuation → provider=gemini POST → gemini-cdp browser bridge job → Electron claim → Flow project/upload/start-frame/prompt/Generate → provider unusual-activity block → one bounded recovery → provider block remains → job failed → run settled.`
- `RELEVANT_EVIDENCE`: `POST /api/v1/projects/cmuc5pkc7000kk5ycb2lg2ksz/videos returned 202 with provider=gemini-browser-cdp; queue claim succeeded; queue payload provider=gemini-cdp; bridgeFailure.code=FLOW_PROVIDER_UNUSUAL_ACTIVITY; details.flowProjectUrl was created; generateTriggered=true; generationStarted=false; providerJobCreated=false; recoveryAttempt=1; recoveryBudget=1.`
- `RECOMMENDED_REPAIR`: `Do not retry automatically or bypass the provider block. Use one normal/manual Flow generation when the provider accepts the account and import the confirmed Scene 4 MP4 through the existing checkpoint; otherwise keep the same run paused.`
- `CHOSEN_REPAIR`: `None in this execution turn; the requested Gemini CDP route was exercised and safely settled.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None — execution-time external provider regression.`
- `TEST_RESULTS`: `CDP route/queue PASS; provider generation FAIL before job creation; completed videos preserved.`
- `LIVE_VALIDATION`: `FAIL at external provider generation; local app route, Electron claim, Flow setup and structured failure settlement PASS.`
- `AUTO_RETRY_ALLOWED`: `NO`
- `STAGE_4_CHECKPOINT_PRESERVED`: `YES — lastCompletedStage=3; resumeTarget=VIDEOS; completedVideoScenes=[1,2,3]; executionLease=null; Scene 4 remains incomplete.`
- `STATUS`: `OPEN — EXTERNAL_PROVIDER_BLOCKED`
- `RESUME_CHECKPOINT`: `Same run; attempt=11; status=FAILED; failedStage=4; resumeTarget=VIDEOS; stage4Provider=GEMINI_BROWSER_CDP; executionLease=null.`
- `NOTES`: `No second automatic submission beyond the existing one bounded recovery. No account/profile/IP/cookie change, provider bypass, database reset or Stage 5 continuation was performed.`

### ISSUE-050

- `ISSUE_ID`: `ISSUE-050`
- `REGRESSION_OF`: `ISSUE-036` / packaged FFmpeg resolver mismatch
- `DISCOVERED_AT`: `2026-09-23T10:12:00+07:00`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `11`
- `STAGE`: `5 — FINAL ASSEMBLY`
- `JOB/SCENE`: `project=cmuc5pkc7000kk5ycb2lg2ksz / scenes 1–4`
- `FIRST_DIVERGENCE`: `FINAL_ASSEMBLY_VIDEO_PROCESSOR_MISSING`
- `SYMPTOM`: `The installed Electron runtime previously could not find FFmpeg during final assembly, although the packaged binary existed under resources\\app.asar.unpacked\\electron\\dist\\ffmpeg\\ffmpeg.exe.`
- `LAST_CONFIRMED_GOOD_STATE`: `Four validated scene files were present in the canonical generated-videos store; Scene 4 had passed Start-frame identity validation.`
- `EXPECTED_STATE`: `Electron resolves the FFmpeg binary shipped with the same package, renders final.mp4, validates it, and persists the completed Stage-5 checkpoint.`
- `ACTUAL_STATE`: `The resolver checked resources\\ffmpeg and development __dirname\\dist paths but omitted the electron-builder app.asar.unpacked path. The patched current-worktree runtime resolved its bundled FFmpeg and rendered final.mp4 successfully.`
- `ROOT_CAUSE`: `Packaged FFmpeg placement and Electron runtime resolution were not aligned; the asar-unpacked packaged path was missing from findFfmpegPath().`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs findFfmpegPath() before final-video normalization`
- `FAILURE_CALL_CHAIN`: `Stage-5 final assembly → video-editor:render-final → findFfmpegPath() → packaged path omitted → FINAL_ASSEMBLY_VIDEO_PROCESSOR_MISSING.`
- `RELEVANT_EVIDENCE`: `Source now checks resources\\app.asar.unpacked\\electron\\dist\\ffmpeg\\ffmpeg.exe; targeted Flow/Electron tests 20/20 passed; typecheck and syntax checks passed; dev runtime identity matched the recovery worktree; direct Electron render returned status=completed; final.mp4 is 8,332,562 bytes, SHA-256 145FE9637C5E7F62E2894E560D50950C055EEA3740A2F3FDAAAFF00219217D23, duration 15.14s, H.264/AAC, 720x1280.`
- `RECOMMENDED_REPAIR`: `Resolve the asar-unpacked FFmpeg candidate before machine-wide fallbacks and use the same bundled binary in packaged builds.`
- `CHOSEN_REPAIR`: `Added the electron-builder app.asar.unpacked FFmpeg candidate to findFfmpegPath(), rebuilt the current renderer/runtime from the recovery worktree, and ran final assembly through the patched Electron bridge without regenerating scenes.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `Extended ISSUE-042 FFmpeg resolver regression test to require the packaged-unpacked candidate.`
- `TEST_RESULTS`: `PASS — targeted Electron tests 20/20; npm run typecheck PASS; node --check electron/main.cjs and electron/prepare-desktop.mjs PASS; final media probe PASS. A later packaging attempt with the dev server concurrently active did not complete the Next build and was not used for live validation.`
- `LIVE_VALIDATION`: `PASS — current-worktree renderer identity matched; current-worktree Electron rendered the existing four scene files; app API PATCH persisted status=SUCCEEDED, lastCompletedStage=5, failedStage=null, resumeTarget=null, executionLease=null.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=SUCCEEDED; lastCompletedStage=5; failedStage=null; resumeTarget=null; attemptCount=11; finalVideoReady=true; executionLease=null.`
- `NOTES`: `No scene was regenerated. No database reset, browser-profile change, cookie change, provider retry, or release publication was performed. Full regression/release-candidate work remains separate from this Stage-5 repair.`

### ISSUE-051

- `ISSUE_ID`: `ISSUE-051`
- `DISCOVERED_AT`: `2026-09-23T10:42:09+07:00`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `11`
- `STAGE`: `Release validation`
- `FIRST_DIVERGENCE`: `FULL_REGRESSION_ENVIRONMENT_AND_CONTRACT_TEST_FAILURES`
- `SYMPTOM`: `The first full regression run reported TEST_FFMPEG_NOT_FOUND in post-assembly media-handler suites, a stale queue-test expectation after Gemini browser jobs were added, and a broad strict-modeling assertion that rejected an unrelated CDP file-input helper.`
- `LAST_CONFIRMED_GOOD_STATE`: `Stage 5 had already passed; targeted Electron tests, typecheck, syntax checks and final media validation were green.`
- `EXPECTED_STATE`: `The complete test suite must discover the same bundled FFmpeg used by the application, assert the current queue exclusion contract, and scope prompt-contract assertions to the prompt compiler.`
- `ACTUAL_STATE`: `Development test discovery omitted the repository-bundled FFmpeg candidate; the queue assertion expected only desktop.flow exclusion; the prompt assertion scanned the whole Electron main file.`
- `ROOT_CAUSE`: `Release validation helpers and tests had not been updated for the final packaged-runtime/CDP changes.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `RECOMMENDED_REPAIR`: `Resolve the repository-bundled FFmpeg candidate during development, update the queue regression expectation, and avoid a file-wide assertion for an unrelated helper token.`
- `CHOSEN_REPAIR`: `Added executable validation for electron/dist/ffmpeg before CapCut fallback, updated stale-job exclusion coverage for desktop.gemini jobs, and replaced the unrelated toUpperCase token with a case-insensitive node-name check.`
- `FILES_CHANGED`: `src/modules/post-assembly-qa/smoke-ring-handler.ts; src/lib/jobs/queue.test.ts; electron/main.cjs; CHANGELOG.md; docs/live-debug/STABILIZATION_SUMMARY.md`
- `TESTS_ADDED`: `Release validation of repository-bundled FFmpeg discovery; updated queue contract assertion.`
- `TEST_RESULTS`: `PASS — targeted suites 219/219; full regression PASS after repair; typecheck PASS; lint PASS with warnings only; syntax PASS; build/package checks PASS.`
- `LIVE_VALIDATION`: `Final Stage-5 MP4 remains valid and the release build uses the bundled FFmpeg runtime.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=SUCCEEDED; lastCompletedStage=5; resumeTarget=null; executionLease=null.`
- `NOTES`: `No production data, browser profile, cookies, provider account, or historical successful run was reset or deleted.`

### ISSUE-052

- `ISSUE_ID`: `ISSUE-052`
- `DISCOVERED_AT`: `2026-09-23T10:51:00+07:00`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `11`
- `STAGE`: `Release packaging`
- `FIRST_DIVERGENCE`: `PACKAGING_FFMPEG_SOURCE_DELETED_BEFORE_COPY`
- `SYMPTOM`: `electron:build validated a configured FFmpeg located under electron/dist, then removed electron/dist before copying the same binary into the packaged output.`
- `LAST_CONFIRMED_GOOD_STATE`: `Production Next build and full regression were PASS; the repository-bundled FFmpeg was valid before electron:prepare.`
- `EXPECTED_STATE`: `electron:prepare must preserve or stage a configured FFmpeg source before recreating electron/dist.`
- `ACTUAL_STATE`: `electron:prepare failed with ENOENT while copying electron/dist/ffmpeg/ffmpeg.exe after deleting that directory.`
- `ROOT_CAUSE`: `The packaging script used an output-directory source without protecting it from its own cleanup step.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `RECOMMENDED_REPAIR`: `Stage a configured FFmpeg source outside electron/dist before cleanup, then copy the staged binary into the package.`
- `CHOSEN_REPAIR`: `Added temporary staging for any FFmpeg source inside the packaging output directory and cleanup after the worker bundle is built.`
- `FILES_CHANGED`: `electron/prepare-desktop.mjs; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/STABILIZATION_SUMMARY.md`
- `TESTS_ADDED`: `Packaging validation using the repository-bundled FFmpeg source.`
- `TEST_RESULTS`: `PASS — production build, Electron prepare, electron-builder NSIS packaging, packaged helper inspection, and installer hash completed successfully.`
- `LIVE_VALIDATION`: `PASS — Modeling.AI.Setup.1.0.7.exe exists; app.asar contains the required Electron helpers; app.asar.unpacked contains the bundled FFmpeg executable.`
- `STATUS`: `FIXED`
- `RESUME_CHECKPOINT`: `runStatus=SUCCEEDED; lastCompletedStage=5; resumeTarget=null; executionLease=null.`
- `NOTES`: `No production data, browser profile, cookies, provider account, or historical successful run was reset or deleted.`

### ISSUE-053

- `ISSUE_ID`: `ISSUE-053`
- `REGRESSION_OF`: `None — new focused Gemini Video composer test; previous production run remains successful.`
- `DISCOVERED_AT`: `2026-09-23T04:11:13.353Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `focused-single-scene-test-1 (production attempt remains 11)`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 — direct Electron Gemini-CDP IPC test; no BackgroundJob was created.`
- `FIRST_DIVERGENCE`: `GEMINI_VIDEO_UPLOAD_MENU_NOT_READY`
- `SYMPTOM`: `The Gemini-CDP video path opened the Gemini /videos page, but stopped before uploading the Scene-4 reference image because the upload menu/action never became available.`
- `LAST_CONFIRMED_GOOD_STATE`: `Current-worktree renderer identity matched sourceCommit ad92c97; Prompt Fidelity preparation returned HTTP 200; scene-4.png existed (949,096 bytes); Electron exposed desktopGemini.runVideoJob; the canonical Edge CDP target loaded https://gemini.google.com/videos.`
- `EXPECTED_STATE`: `The actual Gemini Video composer is selected and ready, the upload control/file input is available, the Scene-4 reference preview is confirmed, and only then prompt submission and generation are attempted.`
- `ACTUAL_STATE`: `Electron accepted https://gemini.google.com/videos as videoMode because the route itself was treated as sufficient. Read-only CDP inspection showed the general Gemini tools menu with visible labels “Nội dung tải lên và công cụ”, “Tệp” and “Tạo video”, but uploadAction=false. The helper wait expired with GEMINI_VIDEO_UPLOAD_MENU_NOT_READY.`
- `ROOT_CAUSE`: `The Gemini /videos UI contract was narrower than the live DOM: the current Video landing/composer exposes the reference entry as “Tệp” inside the uploads/tools menu, while uploadGeminiVideoReference() only recognized the older upload labels. The route must be accepted only with the rendered Video landing heading/input, and the generic chat-menu “Tạo video” item must not be clicked during /videos hydration because it navigates back to /app.`
- `ROOT_CAUSE_CONFIDENCE`: `CONFIRMED`
- `ERROR_THROW_SITE`: `electron/main.cjs — uploadGeminiVideoReference() upload-menu readiness wait; caused by geminiVideoUiState() not recognizing the current “Tệp” entry and by an unsafe attempt to re-select the generic chat tool during /videos hydration.`
- `FAILURE_CALL_CHAIN`: `window.desktopGemini.runVideoJob → runGeminiVideoJobUnlocked → openGeminiVideoComposer (rendered /videos landing gate) → uploadGeminiVideoReference → open uploads/tools menu → recognize “Tệp” → CDP file attach/preview confirmation.`
- `RELEVANT_EVIDENCE`: `Direct CDP IPC result: phase=VIDEO_JOB, progress stopped at “Đang mở Gemini tạo video cảnh 4...”, error=GEMINI_VIDEO_UPLOAD_MENU_NOT_READY. Edge CDP 9333 target remained at https://gemini.google.com/videos; DOM readback reported videoRoute=true, inputReady=true, createVideoMenu=true, uploadAction=false. No prompt was sent, Generate was not clicked, no provider job was created, and no provider error occurred. Existing scene-4.mp4 remained unchanged at 681,673 bytes, SHA-256 8F3004D2EC57605A39D5F8F529FDF1C11AAF5CC2DC12D1D40AABC15872E24FC0.`
- `RECOMMENDED_REPAIR`: `Require rendered /videos Video landing evidence (heading plus usable input), do not re-click the generic chat “Tạo video” item on that route, recognize the current “Tệp” upload entry, and confirm the reference preview before prompt submission. Do not change provider, retry count or anti-abuse behavior.`
- `CHOSEN_REPAIR`: `Updated geminiVideoUiState() with explicit videoLanding/videoMode evidence, current menu selectors (including gem-list-item/menuitem), “Tệp” upload recognition, and a direct /videos readiness path that does not click the destructive generic chat-mode menu during hydration.`
- `FILES_CHANGED`: `electron/main.cjs; electron/flow-prompt-input.test.ts; docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `ISSUE-053 source-contract tests for route-only rejection, rendered Video landing readiness, current Gemini menu item selectors, and “Tệp” upload handling.`
- `TEST_RESULTS`: `Targeted flow-prompt-input suite PASS (23/23); typecheck PASS; node --check electron/main.cjs PASS; git diff --check PASS. The first focused run exposed an over-eager tool-selection branch; read-only CDP confirmed the live /videos landing is valid and that clicking generic “Tạo video” navigates to /app. After the correction, the focused test passed composer opening, reference upload and preview, and prompt preparation.`
- `LIVE_VALIDATION`: `Original ISSUE-053 divergence FIXED and live path reached the send boundary. A later first divergence occurred after the repair: Gemini reset /videos to bare /app during prompt send and produced GEMINI_VIDEO_PAGE_RESET_DURING_SEND; recorded separately as ISSUE-054. No provider generation, no Generate acknowledgement, and no canonical scene-4 overwrite occurred.`
- `STATUS`: `FIXED — composer/readiness repair verified; follow-up send-reset ISSUE-054 is OPEN.`
- `RESUME_CHECKPOINT`: `Production run unchanged: status=SUCCEEDED; lastCompletedStage=5; failedStage=null; resumeTarget=null; completedVideoScenes=[1,2,3,4]; executionLease=null. Focused test status=FAILED; automatic retry=NO.`
- `NOTES`: `No production resume, no retry after the send reset, no provider generation, no account/profile/cookie change, no DB reset, no canonical video overwrite, and no Stage-5 continuation. Focused validation used the same canonical Edge profile and CDP route; production run remains SUCCEEDED.`

### ISSUE-054

- `ISSUE_ID`: `ISSUE-054`
- `REGRESSION_OF`: `None — new send-boundary failure discovered after ISSUE-053 composer/readiness repair.`
- `DISCOVERED_AT`: `2026-09-23T04:38:34.703Z`
- `RUN_ID`: `cmuc51vjr0006k5ycwa04qxgq`
- `ATTEMPT`: `focused-single-scene-test-3 (production attempt remains 11)`
- `STAGE`: `4 — VIDEO GENERATION`
- `JOB/SCENE`: `Scene 4 — direct Electron Gemini-CDP IPC test; no BackgroundJob was created.`
- `FIRST_DIVERGENCE`: `GEMINI_VIDEO_PAGE_RESET_DURING_SEND`
- `SYMPTOM`: `The focused Gemini Video path opened the correct /videos landing, uploaded and confirmed the Scene-4 reference, prepared the prompt, then the page reset to bare /app while the prompt send was being confirmed.`
- `LAST_CONFIRMED_GOOD_STATE`: `Prompt Fidelity returned HTTP 200; rendered /videos Video landing was accepted; current “Tệp” upload entry was opened; reference attachment/preview confirmation completed; send boundary was reached.`
- `EXPECTED_STATE`: `Gemini remains on the active Video page, a new exact user turn is confirmed, generation starts, and only then response/video completion is awaited.`
- `ACTUAL_STATE`: `Gemini navigated to https://gemini.google.com/app during send; no confirmed user turn, no generation-start evidence, no provider job, and no new scene-4.mp4 were produced. The bounded path surfaced GEMINI_VIDEO_PAGE_RESET_DURING_SEND.`
- `ROOT_CAUSE`: `A valid Gemini Video page reset to the bare Gemini app during prompt submission. The observed reset is confirmed, but the underlying provider/session reason (cookie rotation, auth refresh, or another Gemini navigation event) is not proven by this focused run.`
- `ROOT_CAUSE_CONFIDENCE`: `UNKNOWN`
- `ERROR_THROW_SITE`: `electron/main.cjs — runGeminiVideoJobUnlocked() submitVideoPrompt() recovery catch, terminal GEMINI_VIDEO_PAGE_RESET_DURING_SEND.`
- `FAILURE_CALL_CHAIN`: `window.desktopGemini.runVideoJob → runGeminiVideoJobUnlocked → openGeminiVideoComposer PASS → uploadGeminiVideoReference PASS → submitGeminiCommand → submission not confirmed + URL bare /app → bounded recovery terminal error.`
- `RELEVANT_EVIDENCE`: `Focused CDP result at 2026-09-23T04:38:34.703Z: progress reached “Đang gửi prompt cảnh 4 tới Gemini...”; final message GEMINI_VIDEO_PAGE_RESET_DURING_SEND. Edge CDP 9333 ended at https://gemini.google.com/app. generationStarted=false; providerJobCreated=false; no Generate acknowledgement; canonical scene-4.mp4 remained preserved.`
- `RECOMMENDED_REPAIR`: `Investigate the Gemini send/reset boundary read-only and preserve the structured reset as the primary error. Do not retry automatically, do not bypass provider/session controls, and do not change the ISSUE-053 composer repair.`
- `CHOSEN_REPAIR`: `None — repair is not authorized for ISSUE-054 in this turn; failure was recorded and execution stopped.`
- `FILES_CHANGED`: `docs/live-debug/LIVE_DEBUG_LEDGER.md; docs/live-debug/LIVE_DEBUG_STATE.json`
- `TESTS_ADDED`: `None.`
- `TEST_RESULTS`: `ISSUE-053 targeted suite/typecheck/syntax/diff checks PASS; focused CDP validation reached send then failed at the new reset boundary.`
- `LIVE_VALIDATION`: `FAIL — GEMINI_VIDEO_PAGE_RESET_DURING_SEND; no retry.`
- `STATUS`: `OPEN — SEND_RESET_AFTER_COMPOSER_REPAIR`
- `RESUME_CHECKPOINT`: `Production run unchanged: status=SUCCEEDED; lastCompletedStage=5; failedStage=null; resumeTarget=null; completedVideoScenes=[1,2,3,4]; executionLease=null. Focused test settled with no production lease.`
- `NOTES`: `Do not treat this as a provider generation failure or as ISSUE-053 regression without further evidence. No production data, profile, cookies, or canonical media were mutated.`
