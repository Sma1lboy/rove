---
"@sma1lboy/rove": patch
---

Stop the workflow-ordering test from naming a specific successor job. It sliced
the `visual-ground-truth` job by searching for `coverage-cap:`, so deleting that
job broke a test about something else entirely — whether the build step runs
before the visual step. It now finds the next top-level job by shape, or
end-of-file when there is none.
