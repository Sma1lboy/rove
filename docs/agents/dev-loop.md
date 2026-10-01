# Agent dev loop: mechanics behind AGENTS.md

`AGENTS.md` keeps the rules; this page keeps the mechanics those rules point at.

## Test runners

Three runners. Picking the wrong one looks like a broken environment.

| Path | Runner | Command |
| --- | --- | --- |
| `test/render/**` | bun's own runner (OpenTUI needs bun) | `bun test test/render` |
| `test/daemon/**` | vitest with `KOBE_INCLUDE_SOCKET=1` | `bun run test:socket` |
| everything else | vitest | `bun run test:fast`, or `bun x vitest run <file>` |

- `test/daemon/**` without `KOBE_INCLUDE_SOCKET=1`: vitest prints "No test files found" and exits 1. It is a silent skip that reads like a missing file, not a wrong command.
- A vitest file run with `bun test` fails on vitest-only APIs. `vi.hoisted is not a function` is the usual signature and reads like a missing dependency.
- If a test "can't run", check the runner before concluding anything about the environment.

## Scripts and dev flavours

Run scripts via `bun --filter @sma1lboy/rove <script>` or `cd packages/kobe && bun <script>`.

- `dev` — real engines, **production** Rove state.
- `dev:sandbox` — real engines + your real `HOME`, throwaway Rove state under `packages/kobe/.dev-sandbox/home`. Use this one.

The old `@sma1lboy/kobe` package name is frozen at 0.9.64; `kobe-docs/` is the public docs site (Fumadocs on Next.js, static export, content synced from `docs/`).

## Daemon boundaries

Mechanics: [`docs/design/daemon.md`](../design/daemon.md).

- Long-lived, refcounted on attached GUIs. Background consumers subscribe with `role: "pane"`; attached TUI clients hold GUI lifetime.
- Hosted engine PTYs belong to the separate PTY host and survive daemon restarts, EXCEPT sessions whose task left the index (a booting daemon sweeps those). The PTY host keeps its boot-time build until `rove reset`.
- Read `<ROVE_HOME>/.rove/daemon.log` first when debugging. After editing daemon/orchestrator/engine code, `rove daemon restart` — Bun doesn't hot-reload.

## Per-repo init

A repo can ship `.rove/init.sh` (runs before the engine, in the worktree) and `.rove/init-prompt.md` (the engine's first message). `.kobe/` spellings remain field-by-field fallbacks; repo files win over the per-user state.json override. Mechanics: [`src/state/repo-init.ts`](../../packages/kobe/src/state/repo-init.ts), user docs in [`CONFIGURATION.md`](../CONFIGURATION.md).

## Engine-owned UI data

Neutral layers (TUI, web, orchestrator) must not hard-code Claude/Codex strings or derive vendor metrics:

- Name/label copy comes from the engine registry (`AIEngine.identity.shortName`) — `Ask ${engine.shortName}`, never a literal `"Ask Claude…"`.
- Terminal-presentation policy comes from `EngineCapabilities`, keyed by the task's vendor; model/effort choices come from the registry entry's `effortLevels`/`effortArgv`.
- History is an engine-owned `EngineHistory`; token/context/speed are engine-normalized. Don't parse vendor transcript files or reconstruct speed in the UI.
- Subagent steps are engine-owned nested data (tagged by `parentId`, nested one level under the parent Agent row), not flattened transcript noise.

## Layout

opentui boxes are Yoga flexbox. Default to flex flow (`flexGrow`/`flexShrink`/`flexBasis`/`flexDirection`) — panes share width by ratio, not pixels. Hardcoded `width={N}`/`height={N}` only for a documented convention (the 12-cell sidebar rail), a terminal-grammar fixed glyph (a 2-cell `+`/`-` diff column), or a modal overlay. `width={N}` meaning "this big proportionally" is `flexGrow={N}`. Avoid `height="100%"`; use `flexGrow={1}`.

## File size

~500 lines is a refactor prompt, not a budget. Write the clear thing, then split along a named seam (this half owns X, that half owns Y), never by line count. Growing a file that is over, or pushing one past it, means you own the split; "no seam" is a valid answer in the PR. CI gates growth only (`pr-gates.yml` file-size-cap). Exempt: generated, lockfiles, fixtures, `refs/`; a deliberate exception needs one line of justification.
