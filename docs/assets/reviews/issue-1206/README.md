# Kanban repository identity evidence

Matched browser captures for PR #1207. No production source changed during this evidence run.

- Capture: Chromium `/harness` → xterm.js → node-pty sidecar → Bun → real OpenTUI `KanbanPage` and `useKanbanBoards`.
- Viewport: 1280×800 CSS pixels, DPR 1, PNG 1280×800.
- Fixture: alpha, orbit-sdk, zebra. Task paths use `c:/repos/<project>/`; issue reads return `C:\repos\<project>`. Active and focused task T1 belongs to orbit-sdk, linked to story #7. No saved repositories.
- Theme: claude, dark, opaque; identical persisted preferences in both runs.
- Before: hook from `6cb83b8e79be0bf367d57a7f769a29ac50b68768`, the fix's parent. Other components and dependencies come from the fixed checkout.
- After: hook from `08981ed99d382879097b7bd2bf6868a12bd9d21d`.

The fixture supplies fixed orchestrator responses to the actual page. This is a pane-host browser/PTy capture on macOS, not a native Windows filesystem or live-daemon test. `build.ts` substitutes only the baseline hook for Before; it does not emulate rendering or change either hook's logic.

| State | Initial frame | Enter through xterm |
| --- | --- | --- |
| Before | `alpha 1/6`, no selected story | No detail drawer |
| After | `orbit-sdk 2/3`, story #7 highlighted | Story #7 detail drawer opens |

`before.png` and `after.png` are the matched initial frames. The `*-detail.png` pair records the same Enter action. Text files are xterm buffer reads, and `capture.json` records provenance, process IDs, and initial-frame hashes.

Run from the repository root with dependencies and Playwright Chromium installed, with ports 5573 and 5575 free:

```sh
bun docs/assets/reviews/issue-1206/build.ts
bun docs/assets/reviews/issue-1206/capture.ts
```

The capture runner uses `/private/tmp/rove-1206-evidence` for isolated preferences and runtime paths. It closes only its own browser, sidecars and Vite process. Both ports were confirmed free after capture.

Remote review series: https://share.sma1lboy.me/s/rove-issue-1206

The configured `brand-studio.sma1lboy.me` host returned HTTP 404. Publication uses the current endpoint documented in `brand-studio/share-server/README.md`, `share.sma1lboy.me`, with the same series for all rounds. PR images use committed GitHub raw URLs because share-server pages expire after an idle day.
