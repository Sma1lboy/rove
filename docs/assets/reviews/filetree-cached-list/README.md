# File list cache evidence

Existing contributor captures for PR #1224, checked at source head
`1ec9aa7c8a55523c1aa266e9a26548ae0da71f61`. Images are pinned to the
asset commit; no screenshot binaries are stored on this branch.

| Before | After |
| --- | --- |
| ![Before](https://raw.githubusercontent.com/sma1lboy/rove/3a6c8f3a65a03d5392fea9ef9e4184fd5cdd27ff/shots/2026-10-08/typing-before.png) | ![After](https://raw.githubusercontent.com/sma1lboy/rove/3a6c8f3a65a03d5392fea9ef9e4184fd5cdd27ff/shots/2026-10-08/typing-after.png) |

Capture: /harness → xterm.js → PTY sidecar → OpenTUI, `perf:measure` typing-phase screenshot after 10 task switches
Viewport: 1280×800
Fixture: perf fixture (perf-a / perf-b tasks on bash)
Theme: default

The settled frames show the Files pane after switching tasks. They do not
measure the transient blank interval; the PR reports the switch commit counts.
The capture driver is `packages/rove-harness/e2e/perf-measure.ts`.

| Image | SHA-256 |
| --- | --- |
| Before | `130590913002a87a03aa6d91f5cbc0dbc529b25800c1917cdc5b71ba50f55237` |
| After | `bbaf608e4667806b725293daa9572921a02693027aab24733aa970c699ffd0a3` |
