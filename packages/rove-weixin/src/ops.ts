/**
 * {@link RoveOps} over the real `rove api` verbs, run in-process against a
 * daemon client — so a WeChat `send`/`add` behaves exactly like the CLI verb,
 * refusals included.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { invokeVerb } from "@sma1lboy/rove/src/cli/api-cmd.ts"
import { loadContext } from "@sma1lboy/rove/src/cli/api/handlers-context.ts"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import type { DaemonRpc } from "@sma1lboy/rove/src/cli/daemon-session.ts"
import { ensurePluginEnginesLoaded } from "@sma1lboy/rove/src/engine/plugin-engines.ts"
import { getSavedRepos } from "@sma1lboy/rove/src/state/repos.ts"
import type { RoveOps, TaskRef } from "./commands.ts"

/** High enough that the status counts cover the whole fleet. */
const STATUS_TASK_LIMIT = 500

function stringField(value: unknown, key: string): string | undefined {
  if (value && typeof value === "object" && key in value) {
    const field: unknown = Reflect.get(value, key)
    if (typeof field === "string") return field
  }
  return undefined
}

async function liveTasks(client: DaemonRpc): Promise<SerializedTask[]> {
  const { tasks } = await client.request<{ tasks: SerializedTask[] }>("task.list")
  return tasks.filter((t) => t.deletion?.phase !== "queued" && t.deletion?.phase !== "running")
}

export function createRoveOps(client: DaemonRpc): RoveOps {
  return {
    status: async (repo) => (await loadContext(client, defaultApiRuntime, { repo, limit: STATUS_TASK_LIMIT })).payload,

    tasks: async (): Promise<TaskRef[]> =>
      (await liveTasks(client)).map((t) => ({ id: t.id, title: t.title, repo: t.repo })),

    repos: async () => [...new Set([...getSavedRepos(), ...(await liveTasks(client)).map((t) => t.repo)])],

    send: async (taskId, tab, prompt) => {
      // `--plain`: the text is the user's own words, not a peer agent's.
      const result = await invokeVerb(
        "send",
        ["--task-id", taskId, ...(tab ? ["--tab", tab] : []), "--plain", "--prompt", prompt],
        { client },
      )
      // `session` is `<taskId>::<tabId>`.
      const session = stringField(result, "session")
      const landedTab = session?.split("::")[1]
      const started = Boolean(result && typeof result === "object" && Reflect.get(result, "started") === true)
      return { ...(landedTab ? { tab: landedTab } : {}), started }
    },

    add: async (repo, prompt) => {
      // As `runApiSubcommand` does: a repo whose default engine is a plugin's
      // must not launch as `generic`.
      ensurePluginEnginesLoaded()
      const result = await invokeVerb("add", ["--repo", repo, "--prompt", prompt], { client })
      const taskId = stringField(result, "taskId")
      if (!taskId) throw new Error("add returned no task id")
      return { taskId }
    },
  }
}
