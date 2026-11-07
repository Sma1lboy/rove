/**
 * `search` — find text across every task's engine conversations (`engine/session-search.ts`), newest
 * session first. Only user and assistant prose is searched: tool calls and their output would match
 * nearly everything.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { PER_SESSION, type SearchResult, searchTasks } from "../../engine/session-search.ts"
import { daemonOf, repoFilter } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

async function search(ctx: VerbContext): Promise<SearchResult> {
  const query = (ctx.args.str("query") ?? "").trim()
  if (!query) throw new ApiError("search needs a non-empty --query", "MISSING_FLAG")
  const limit = Math.min(MAX_LIMIT, Math.max(1, ctx.args.int("limit") ?? DEFAULT_LIMIT))
  const daemon = daemonOf(ctx)
  const { tasks: all } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  const repoFlag = ctx.args.str("repo")
  let tasks = all
  if (repoFlag) {
    const filter = await repoFilter(
      ctx.runtime,
      ctx.args.requireRepo("repo"),
      all.map((t) => t.repo),
    )
    tasks = all.filter((t) => filter.matches(t.repo))
  }
  return searchTasks(tasks, query, limit)
}

export const SEARCH_VERB: VerbSpec = {
  name: "search",
  group: "read",
  summary:
    "Search every task's engine conversations (user and assistant prose, not tool output), newest session first. Returns {query, matches:[{taskId, title, tabId?, role, at, snippet}], skipped:[{taskId, reason}], truncated}; reason is other-machine or engine-unsupported (an engine with no history reader).",
  flags: [
    {
      name: "query",
      type: "string",
      required: true,
      placeholder: "TEXT",
      description: "Text to find, case-insensitive.",
    },
    {
      name: "repo",
      type: "string",
      required: false,
      placeholder: "PATH",
      description: "Only this repo's tasks. Relative paths resolve against $PWD.",
    },
    {
      name: "limit",
      type: "int",
      default: String(DEFAULT_LIMIT),
      placeholder: "N",
      description: `Stop after N matches (max ${MAX_LIMIT}); at most ${PER_SESSION} per session.`,
    },
  ],
  handler: search,
}
