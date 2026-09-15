import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"

it("keeps directory-wide transcript APIs out of tab activity consumers", () => {
  const consumers = [
    "src/tui/panes/sidebar/row-view.ts",
    "src/tui/panes/sidebar/tab-row-activity.ts",
    "src/tui-react/panes/sidebar/tree-rows.tsx",
    "src/tui-react/workspace/show-workspace.tsx",
    "src/tui-react/workspace/use-turn-polls.ts",
    "src/tui/ops/activity-monitor.ts",
    "../kobe-daemon/src/daemon/activity-liveness.ts",
  ]
  for (const path of consumers) {
    const source = readFileSync(resolve(import.meta.dirname, "../..", path), "utf8")
    expect(source, path).not.toMatch(
      /(?:transcriptActivity|sharedActivity|sharedEntry|usingShared|\.latestActivity\(|\.latestCompletion\(|\.latestTranscriptMtime\()/,
    )
    if (path.endsWith("tab-row-activity.ts") || path.endsWith("tree-rows.tsx")) {
      expect(source, path).not.toMatch(/taskActivity|shared\.engineState/)
    }
  }
})
