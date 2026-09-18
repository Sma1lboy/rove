---
"@sma1lboy/rove": patch
---

Cursor's session hook now reaches the right task, and every engine's hook payload survives the released CLI.

Cursor runs its hooks from its own config directory and never sends a `cwd` — the workspace is only in `workspace_roots`. So the hook Rove installs reported `~/.cursor`, matched no task, and was dropped while the install looked perfect. An adapter can now say where a payload's working directory really is, and cursor's does.

Separately, the payload itself was being thrown away in every released build: the published CLI runs under node, and the only stdin reader was `Bun.stdin.text()`, which throws there. Hooks fired, exited cleanly, and carried no session id, no failure class and no cwd. Sessions started inside a Rove tab were unaffected — they identify themselves through the environment — which is why nothing looked wrong.
