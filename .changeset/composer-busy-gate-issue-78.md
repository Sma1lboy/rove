---
"@sma1lboy/rove": patch
---

Add A+C delivery gates so `rove api send` no longer pastes into a busy composer (issue #78).

- A-layer: the PTY host now records `lastHumanWriteMs` for writes that come from an attached client. `pty.peek` returns the timestamp and the configurable quiet period (`KOBE_PTY_HUMAN_WRITE_QUIET_MS`, default 10s); delivery is refused while the window is open.
- C-layer: new pure `isComposerEmpty(ringBytes, manifest)` renders ring bytes through headless xterm and evaluates engine-owned `composerEmpty` rules. Manifests added for Claude, Kimi, and Codex; engines without a manifest skip this gate (fail-open).
- Delivery paths (`api send`, `api add --prompt`, exact-tab send, daemon quota-resume) now refuse with a typed `COMPOSER_BUSY` error naming the blocking layer instead of silently concatenating peer text with user input.
- Layer B (accept-and-defer) lands separately — see the deferred-prompt-inbox changeset in this release.
