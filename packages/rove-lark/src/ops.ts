/** {@link LarkOps} over the real `rove api` verbs, run in-process against a daemon client (as the WeChat connector does). */

import type { DaemonRpc } from "@sma1lboy/rove-core/client/daemon-session.ts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { invokeVerb } from "@sma1lboy/rove/src/cli/api-cmd.ts"
import { loadContext } from "@sma1lboy/rove/src/cli/api/handlers-context.ts"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import type { LarkOps } from "./bridge.ts"

const STATUS_TASK_LIMIT = 500

function sessionTab(result: unknown): string | undefined {
  const session = result && typeof result === "object" ? Reflect.get(result, "session") : undefined
  return typeof session === "string" ? session.split("::")[1] : undefined
}

export function createLarkOps(client: DaemonRpc): LarkOps {
  return {
    taskExists: async (taskId) => {
      const { tasks } = await client.request<{ tasks: SerializedTask[] }>("task.list")
      return tasks.some((t) => t.id === taskId && t.deletion?.phase !== "queued" && t.deletion?.phase !== "running")
    },
    openAgentTask: async (dir, title) => {
      // The preferred engine is resolved by `task.openDir`, as for `rove .`.
      const { taskId } = await client.request<{ taskId: string }>("task.openDir", { dir })
      await client.request("task.rename", { taskId, title })
      await client.request("task.pin", { taskId, pinned: true })
      await client.request("task.connector", { taskId, connector: "lark" })
      return { taskId }
    },
    newConversation: async (taskId, prompt) => {
      const result = await invokeVerb("add", ["--parent", taskId, "--no-worktree", "--prompt", prompt], { client })
      const tab = sessionTab(result)
      if (!tab) throw new Error("add returned no tab")
      return { tab }
    },
    send: async (taskId, tab, prompt) => {
      // `--plain`: the text is a person's own words, not a peer agent's.
      await invokeVerb("send", ["--task-id", taskId, "--tab", tab, "--plain", "--prompt", prompt], { client })
    },
    taskRunning: async (taskId) => {
      const { payload } = await loadContext(client, defaultApiRuntime, { repo: null, limit: STATUS_TASK_LIMIT })
      return payload.tasks.find((t) => t.taskId === taskId)?.activity?.state === "running"
    },
  }
}
