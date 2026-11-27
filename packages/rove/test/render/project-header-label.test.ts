import { expect, test } from "bun:test"
import { t } from "../../src/tui-react/i18n"
import { projectHeaderLabel } from "../../src/tui-react/panes/sidebar/tree-panel"
import { SCRATCH_SECTION_ID } from "../../src/tui/panes/sidebar/tree-ids"

const project = (over: { id?: string; label?: string; connector?: string }) => ({
  kind: "project" as const,
  id: over.id ?? "/home/.rove/weixin/agent",
  repo: "/home/.rove/weixin/agent",
  label: over.label ?? "agent",
  machineId: "local",
  depth: 0,
  ...(over.connector ? { connector: over.connector } : {}),
})

test("a chat connector's project is named by its app, not its folder; a plugin's keeps the folder", () => {
  expect(projectHeaderLabel(project({ connector: "weixin" }), t)).toBe("WeChat")
  expect(projectHeaderLabel(project({ connector: "lark", label: "agent" }), t)).toBe("Lark")
  expect(projectHeaderLabel(project({ connector: "acme", label: "acme-bot" }), t)).toBe("acme-bot")
  expect(projectHeaderLabel(project({ label: "rove" }), t)).toBe("rove")
  expect(projectHeaderLabel(project({ id: SCRATCH_SECTION_ID, label: "Ungrouped" }), t)).toBe("Ungrouped")
})
