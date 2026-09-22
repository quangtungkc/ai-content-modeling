# App foundation

## Architecture

The application is a Next.js App Router frontend/API, a Prisma persistence layer, domain modules under `src/modules`, reusable integrations under `src/services` and `src/lib`, background workers under `src/workers`, and an Electron desktop shell under `electron/`. The older `src-tauri` directory remains a separate desktop experiment and is not part of the Electron runtime path.

```text
UI (src/app, src/components)
  -> API/application boundary (src/app/api)
    -> domain modules (src/modules)
      -> services/providers (src/services, src/lib/platform, src/lib/ai)
        -> Prisma/database, Redis and external browser/API integrations

Electron main -> preload (small allowlisted bridge) -> renderer UI
Electron main -> local Next server/worker -> persistence and Edge/CDP runtime
```

`/activity` keeps its existing data source and runtime behavior. Edge/CDP, the file chooser path, dynamic backend Node capture, Gemini browser disablement and desktop mode are treated as protected runtime contracts.

## Folder responsibilities

- `src/app`: routes, layouts, loading/error/not-found boundaries and API route handlers.
- `src/components`: UI composition, shell/navigation, notifications, dialogs and reusable presentation primitives.
- `src/modules`: business/domain boundaries. A module owns its schemas, service rules and repositories where needed.
- `src/services`: external provider adapters and application-facing service contracts.
- `src/lib`: cross-cutting infrastructure: `env.ts` validation, `logger.ts`, `redaction.ts`, `errors.ts`, `paths.ts`, database and auth primitives.
- `electron`: main process, preload boundary, Edge/Gemini runtime, IPC contracts, user-data paths and managed temporary cleanup.
- `scripts`: build/release/validation tooling. `npm run build` is the canonical guarded production build.
- `prisma`: schema and migrations. Persistent production data formats are not changed by this foundation pass.
- `src-tauri`: retained legacy/experimental shell; do not mix its runtime assumptions into Electron.

## Config, metadata and flags

`src/lib/env.ts` is the typed validation boundary for server configuration. `getEnv()` validates required secrets and provider settings; `getRuntimeConfig()` exposes the typed runtime mode and the small existing feature-flag set. Business modules should receive validated config or a provider abstraction rather than reading new environment variables directly.

`package.json` is the package metadata source of truth. `src/lib/app-metadata.ts` and Electron's `app.getVersion()` derive display/runtime metadata from that version. Diagnostics expose only non-secret booleans and runtime identity.

## Error handling and logging

Route handlers return `toErrorResponse` with a request ID. Unknown errors are logged with technical context; production responses omit error details and never return stacks. App Router has loading, route error, global error and not-found boundaries with safe user messages. Electron has startup failure handling, uncaught exception/unhandled rejection reporting and graceful child-process shutdown.

`logger` supports `debug`, `info`, `warn` and `error`. `redaction.ts` recursively masks password/token/secret/authorization/cookie/API-key/credential fields and common bearer/provider-token forms before serialization. Do not add raw `console.log` calls to application code.

## Electron and IPC boundaries

The renderer has `contextIsolation: true` and `nodeIntegration: false`. `preload.cjs` exposes only named application methods and checks every invoke channel against `electron/ipc-contract.cjs`; it does not expose Node or Electron wholesale. Main-process handlers validate request shapes before filesystem/browser operations. New channels use `namespace:action` names, validate input/output, and are added to the explicit contract list. External navigation is limited to HTTP(S).

## State and paths

Temporary UI state stays in React state. Session state uses the existing HttpOnly session cookie; credentials are encrypted server-side and are not moved to localStorage. Project/content data remains in Prisma. `src/lib/paths.ts` and `electron/user-data.cjs` define user-data, database, temporary, download, generated and log roots. Managed cleanup can remove only stale entries under the dedicated `temporary` root; it never traverses or deletes user data, production artifacts or generated content roots.

## Module extension pattern

For a new domain feature, keep the existing convention and add a focused module:

```text
src/modules/<feature>/
  schema.ts or validators.ts
  service.ts
  repository.ts          # only when persistence deserves a boundary
  types.ts               # when shared types are non-trivial
  service.test.ts
```

Add UI under `src/components/<feature>` and route handlers under `src/app/api/v1/<feature>`. Route handlers validate/authenticate, call the module service, and translate errors; they should not contain provider/browser or SQL orchestration.

## Tests, build and packaging

Vitest covers unit, integration, provider, runtime, Electron contract and targeted regression tests. `npm test` remains the full suite; `npm run test:build-contention` proves the production build lock across two processes. Run quality gates sequentially: targeted tests, full tests, typecheck, lint, then one `npm run build`.

The build wrapper atomically creates `.next-build.lock` outside `.next`. A live owner makes another build fail fast with `BUILD_ALREADY_RUNNING`; a stale lock is reclaimed safely, and normal completion/failure removes the lock. Never run two production builds against the same `.next` directory. Electron packaging remains a separate sequential step and must not be launched as a production workflow during foundation validation.
