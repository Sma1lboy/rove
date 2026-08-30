---
"@sma1lboy/rove": patch
---

Stop `rove api send` from pasting a peer message into a composer that already holds a half-typed message; a blocked prompt is now accepted-and-deferred, not dropped or hard-rejected (issue #78).

- A-layer: the PTY host records `lastHumanWriteMs` for writes from attached clients and returns it from `pty.peek` with the configurable quiet period (`KOBE_PTY_HUMAN_WRITE_QUIET_MS`, default 10s).
- C-layer: new pure `isComposerEmpty(ringBytes, manifest)` renders ring bytes through headless xterm against engine-owned `composerEmpty` rules (manifests for Claude, Kimi, Codex; engines without one skip the gate, fail-open).
- B-layer (accept-and-defer): when A or C blocks, the prompt text is stored in a new daemon-owned `DeferredPromptsStore` (one record per task+tab, 24h TTL, displacement/expiry/deletion all logged — never silently dropped) and a `prompt_deferred` attention-inbox episode is recorded. `send`/`add --prompt` return an accepted-but-deferred outcome (`deferred: {id, layer}`) which is a SUCCESS — callers must not retry, or the same message stacks in the queue.
- Exit path: opening the `prompt_deferred` inbox item jumps to the tab and inserts the queued message with a FRESH A/C gate (no new chord), then resolves the record + episode; if the composer is still busy the message stays queued. Toast + inbox copy added in both locales.
