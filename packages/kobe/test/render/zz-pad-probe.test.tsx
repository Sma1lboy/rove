/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { renderComponent, settle } from "./harness"
const REPO = "/repos/rove"
test("PROBE padding", async () => {
  const { frame } = await renderComponent(
    <KanbanPage orchestrator={{
      listTasks: () => [{ repo: REPO }],
      listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 9, issues: [
        { id: 1, title: "批量删任务时底部快捷键提示条无限渲染", status: "open", created: "2026-08-31", body: "状态:已修(PR #702),但根因只查清了一半" },
        { id: 2, title: "EngineIdentity 的 productName", status: "open", created: "2026-08-30", body: "这不是缺功能,是承诺 vs 实现对不上" },
      ] }),
      activeTaskSignal: () => ({ get: () => null }),
    } as never} focused={true} onClose={()=>{}} onStartChat={async()=>{}} onOpenTask={()=>{}} />,
    { width: 96, height: 26, providers: { dialog: true, kv: true, notifications: true } })
  await settle()
  console.log("=== FRAME ===")
  console.log(await frame())
  expect(true).toBe(true)
})
