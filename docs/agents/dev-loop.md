# Agent dev loop: mechanics behind AGENTS.md

`AGENTS.md` keeps the rules; this page keeps the mechanics those rules point at.

## Test runners

Three runners in `packages/rove`. Picking the wrong one looks like a broken environment. Other packages run their own `package.json` `test` (`rove-web`, `rove-bridge`: `bun test`; `rove-harness`: vitest + Playwright).

| Path | Runner | Command |
| --- | --- | --- |
| `test/render/**` | bun's own runner (OpenTUI needs bun) | `bun test test/render` |
| `test/daemon/**` | vitest with `ROVE_INCLUDE_SOCKET=1` | `bun run test:socket` |
| everything else | vitest | `bun run test:fast`, or `bun x vitest run <file>` |

- `packages/rove/vitest.config.ts` excludes `test/daemon/**` and `test/orchestrator/bridge.test.ts` unless `ROVE_INCLUDE_SOCKET=1`. Run plainly they match no file, which reads like a missing file, not a wrong command; `test:fast` passes with no tests at all.
- A vitest file run with `bun test` fails on vitest-only APIs. `vi.hoisted is not a function` is the usual signature and reads like a missing dependency.
- If a test "can't run", check the runner before concluding anything about the environment.

## Scripts and dev flavours

Run scripts via `bun --filter @sma1lboy/rove <script>` or `cd packages/rove && bun <script>`.

- `dev` — real engines, **production** Rove state.
- `dev:sandbox` — real engines + your real `HOME`, throwaway Rove state under `packages/rove/.dev-sandbox/home`. Use this one. Its daemon, PTY host and engines keep running after the command exits. A sandbox under `.dev-sandbox/` or a temp directory that no `dev:sandbox` command has touched for 6 hours is stopped, engines included, by the next `dev:sandbox` command or by `dev:sandbox sweep`; its files stay. A running TUI or `--web` bridge counts as use. Stop yours right away with `reset`.

The retired npm package `@sma1lboy/kobe` is frozen at 0.9.64; `rove-docs/` is the public docs site (Fumadocs on Next.js, static export, content synced from `docs/`).

## Daemon boundaries

Mechanics: [`docs/design/daemon.md`](../design/daemon.md).

- Long-lived, refcounted on attached GUIs. Background consumers subscribe with `role: "pane"`; attached TUI clients hold GUI lifetime.
- Hosted engine PTYs belong to the separate PTY host and survive daemon restarts, EXCEPT sessions whose task left the index (a booting daemon sweeps those). The PTY host keeps its boot-time build until `rove reset`.
- Read `<ROVE_HOME>/.rove/daemon.log` first when debugging. After editing daemon/orchestrator/engine code, `rove daemon restart` — Bun doesn't hot-reload.

## Per-repo init

A repo can ship `.rove/init.sh` (runs before the engine, in the worktree) and `.rove/init-prompt.md` (the engine's first message). repo files win over the per-user state.json override. Mechanics: [`src/state/repo-init.ts`](../../packages/rove/src/state/repo-init.ts), user docs in [`CONFIGURATION.md`](../CONFIGURATION.md).

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

## Before opening a PR

The owner's PRs start no cloud CI and merge on `bun run pre-pr -- --body-file <body>` (then `gh pr create --body-file <body>` and `gh pr merge` at once). Run it on its own, or under `set -o pipefail` when piping its output: it exits 1 on any red step, but `pre-pr | tail -1 && gh pr create` takes `tail`'s status. Its default tier is fast, ~20s: changeset-cap and frontmatter, lint, the silent-catch scan, the web UI gate (`scripts/web-ui-gate.mjs`), file-size-cap and UI evidence against that body, the script tests, typecheck, `rove-bridge`/`rove-weixin` plus the tests of other touched workspace packages, and the docs-site build when `docs/` changed. It does **not** run `packages/rove` or `rove-harness` tests (those are `--full`/batch only), build `rove-web` with Vite, or touch `rove-android`/`rove-ios`: run what your change needs yourself. On Windows the package tests run in WSL (the bridge's file-mode tests are POSIX-only).

The full suite (`ci.yml`) is a batch, not a per-PR gate: it runs on `main` every two hours, before every release (`scripts/ci-run-for-sha.sh` dispatches it and waits), and on pull requests from anyone but the owner, along with `pr-gates.yml`. A red batch means one of the PRs merged since the last green one broke it; fix forward.

`bun run pre-pr -- --full` runs that suite locally instead, in a parallel pool (`--jobs`, default half the cores, at least 4): the rove unit tests, the daemon socket suite in two shards, the render track in four shards (eight in cloud CI), behavior in three, the harness PTY tests, the visual ground truth, and on Windows the plugin-windows acceptance (native scenario only) when its paths changed. `ci.yml` runs the same socket suite in its `daemon-tests` job; the fast tier never does (it stays ~20 s).  On Windows the POSIX suites run in a WSL distro against a copy of HEAD (commit first). It cannot run clean-linux-install (docker on Linux/macOS) or the iOS simulator suite. `gh workflow run ci.yml --ref <branch>` runs the cloud suite on a branch.

The native app workflows (`ios.yml`, `android.yml`) skip the owner's PRs the same way, except a PR whose title starts with `[routine]`: the autopilot merges those on its own once every check passes, so they run the simulator and Gradle suites before landing. The prefix must be in the title when the PR opens; editing it in later starts nothing until the next push.

`bun run hooks:install` (once per clone; nothing installs it by default) also enables a pre-push hook that runs only `pre-pr --quick` (changeset gates, lint, silent-catch, the web UI gate: a few seconds). The pre-commit hook stays milliseconds-only.

## Live web preview

The owner's machine only. The owner's live web is the test build: rove-web.sma1lboy.me → `127.0.0.1:7890`, a bridge that `~/srv/rove-web/run.sh` runs in a loop from `/Users/jacksonc/i/rove-local-test` (branch `web/preview`), serving its bundled `packages/rove-web/dist` (not vite dev, not the npm release). Any rove-web change goes there as soon as it works; merging can happen before, after or alongside. Installing there needs no approval. Elsewhere, check rove-web against a `dev:sandbox -- --web` bridge.

1. In `rove-local-test`: `git fetch origin && git merge --no-edit origin/main` once the PR merged, or merge/cherry-pick the feature branch while it is still open. Never reset `web/preview`; it may carry unmerged work.
2. Changed `packages/rove-plugin-sdk/src`? `bun run build` there first (other packages read its `dist/`). Then `bun run build` in `packages/rove-web`.
3. Kill only the bun child listening on 7890 (`kill $(lsof -tiTCP:7890 -sTCP:LISTEN)`), never the `run.sh` loop: it relaunches the bridge on the new code within 3s.
4. Changed daemon/orchestrator/engine code? `bun src/cli/rove.ts daemon restart` from that checkout's `packages/rove`, then check `ps -o command= -p $(cat ~/.rove/daemon.pid)` shows the checkout path (a release client can win the respawn).
5. Verify: the `assets/index-*.js` name in `curl -s https://rove-web.sma1lboy.me/` equals the one in the local `dist/assets/`. Then tell the owner to refresh.

## Diagrams in `docs/`

Mermaid (` ```mermaid ` fences); ASCII only for ≤3 nodes with no states.
