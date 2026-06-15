# AGENTS.md

## Fork Notice

**This repository is a fork.** Upstream is [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) (`upstream/main`); this fork lives at [`imabdulazeez/t3code`](https://github.com/imabdulazeez/t3code) (`origin`). The fork is periodically synced with upstream and re-applies its own additions on top. For detailed fork-specific changes, refer to [FORK-CHANGES.md](./FORK-CHANGES.md).

> **IMPORTANT:** When making a change that deviates from upstream, update the table in [FORK-CHANGES.md](./FORK-CHANGES.md) in the same change. Add a new row (or amend an existing one) describing the change, the files touched, and the key changes. Amending an existing row, and combining similar changes is preferred whenever possible, rather than appending rows unnecessarily. Keeping that table current is mandatory.
>
> Only record a change when it is itself a *fork change*: the fork intentionally introduces, removes, or significantly reworks behavior in a way that is a permanent, lasting deviation from upstream — significant enough to stand on its own as a fork change. Do NOT record routine upstream syncs/merges, the re-application of already-documented fork intent, conflict resolutions, migration renumbers, or verification that fork intent survived a merge — these are bookkeeping, not fork changes, and must be left out. An incoming upstream change is only worth a row if the fork had to modify it to preserve fork behavior AND that modification is itself a significant, lasting deviation; a simple or unmodified upstream change is never recorded.

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

### Apps

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `apps/desktop`: Electron desktop shell (`@t3tools/desktop`). Hosts the web app in a native window and bridges to the server over IPC; Effect-based modules under `src/app`, with `backend`, `electron`, `ipc`, `ssh`, and `window` subsystems.
- `apps/marketing`: Astro marketing site (`@t3tools/marketing`).

### Packages

- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Client-side runtime utilities (`@t3tools/client-runtime`) — advertised-endpoint resolution, known-environment detection, and source-control discovery state shared by web/desktop/mobile.
- `packages/effect-acp`: Effect bindings for the Agent Client Protocol (`effect-acp`) — the JSON-RPC client/agent/protocol layer the ACP runtime in `apps/server/src/provider/acp/` builds on.
- `packages/effect-codex-app-server`: Effect bindings for the Codex app-server JSON-RPC transport (`effect-codex-app-server`) — client/protocol/schema used by the Codex provider.
- `packages/ssh`: SSH utilities (`@t3tools/ssh`) — auth, command execution, config, and tunneling via subpath exports.
- `packages/tailscale`: Tailscale integration helpers (`@t3tools/tailscale`).

## Provider Architecture

T3 Code supports multiple coding-agent providers behind a uniform abstraction: **Codex, Claude, Cursor, and OpenCode**. Each has a driver (`apps/server/src/provider/Drivers/`), a provider layer (`apps/server/src/provider/Layers/*Provider.ts`), and a text-generation adapter (`apps/server/src/textGeneration/*TextGeneration.ts`). Providers that speak the Agent Client Protocol run through the shared ACP runtime in `apps/server/src/provider/acp/`.

The runtime pipeline is provider-agnostic:

- Provider dispatch and session lifecycle are coordinated in `apps/server/src/provider/Services/ProviderService.ts`.
- Provider runtime activity is projected into orchestration domain events in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/ws.ts`; the web app consumes events via WebSocket push on channel `orchestration.domainEvent`.

**Codex** is the one provider with an unusual transport: it spawns `codex app-server` (JSON-RPC over stdio) per session, handled in `apps/server/src/provider/Layers/CodexSessionRuntime.ts` (+ `CodexAdapter.ts`). Docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
