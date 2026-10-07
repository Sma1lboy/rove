# Routine fold UI evidence

The original PNGs are hosted at immutable GitHub commit URLs. They are excluded from the PR diff; the contributor commits remain intact.

- [Before](https://raw.githubusercontent.com/Sma1lboy/rove/483dcc48cdad7d177bc39a3bdeda316f4234d208/docs/assets/reviews/routine-fold-needs-you/before.png): 30,293 bytes, SHA-256 `fd972c3d0bc2d2c3fa6b35e6ae094953c6409893258e03d834924a12c712f523`.
- [After](https://raw.githubusercontent.com/Sma1lboy/rove/4c7e042d6bef2218b1f54f292cb9b7ce4510c25a/docs/assets/reviews/routine-fold-needs-you/after.png): 31,102 bytes, SHA-256 `78200b98aacb7bd9da43a5e92bd36b693d1ed10ae2c7581cf8cda44ccf33a26b`.

Capture: /harness → xterm.js → PTY sidecar → real OpenTUI (`visual:serve` + `visual:shot`; before = same fixture with this PR's `src/` stashed)
Viewport: 1280×800, scale 1
Fixture: isolated visual fixture; three `--persistent-session` routines run once, one marked awaiting input via `rove hook awaiting-input`
Theme: default dark

[Review board](https://share.sma1lboy.me/s/rove-pr-1222-routine-fold-needs-you). The board expires after one idle day; the image links above are the durable evidence.
