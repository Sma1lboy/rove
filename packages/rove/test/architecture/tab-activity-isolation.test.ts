import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8")

it.each([
  "src/tui/panes/sidebar/row-view.ts",
  "src/tui/panes/sidebar/tab-row-activity.ts",
  "src/tui-react/panes/sidebar/tree-rows.tsx",
  "src/tui-react/workspace/show-workspace.tsx",
  "src/tui-react/workspace/use-turn-polls.ts",
  "src/tui/ops/activity-monitor.ts",
  "../rove-daemon/src/daemon/activity-liveness.ts",
])("%s keeps directory-wide transcript APIs out of tab activity", (path) => {
  expect(read(path)).not.toMatch(
    /(?:transcriptActivity|sharedActivity|sharedEntry|usingShared|\.latestActivity\(|\.latestCompletion\(|\.latestTranscriptMtime\()/,
  )
})

it.each(["src/tui/panes/sidebar/tab-row-activity.ts", "src/tui-react/panes/sidebar/tree-rows.tsx"])(
  "%s reads no task-wide activity",
  (path) => {
    expect(read(path)).not.toMatch(/taskActivity|shared\.engineState/)
  },
)
