/**
 * `panel.show` (`rove api panel-show`): bring up the web side panel (Files / Diff / Browser) on a
 * task. Like `tab.open` the daemon validates and publishes; each web client remembers the view
 * for the task, and one that is on the task with a panel opens it. The daemon owns nothing else:
 * it only reports who it expects to show it (`viewers`) and whether a page can be framed.
 */

import { isAbsolute, normalize } from "node:path"
import { checkFrame, isLoopbackHost } from "./frame-check.ts"
import { objectPayload, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import type { Viewer } from "./viewers.ts"

export const PANEL_VIEWS = ["browser", "files", "diff"] as const

/** A relative path that stays inside the worktree: not absolute, no `..` segment. */
function validPath(path: string): string {
  const clean = normalize(path)
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    clean === ".." ||
    clean.startsWith("../") ||
    path.split(/[\\/]/).includes("..")
  ) {
    throw new Error("path must be relative to the task's worktree, without `..`")
  }
  return clean
}

function validUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("url must be an http(s) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must be an http(s) URL")
  return url
}

/** What the daemon can say about a URL before any page loads it. */
async function judgeUrl(url: URL, viewers: readonly Viewer[]) {
  if (!isLoopbackHost(url.hostname)) {
    const { reachable, frameable, reason } = await checkFrame(url.href)
    return { reachable, frameable, ...(reason ? { reason } : {}) }
  }
  // `localhost` is the agent's machine: a remote web screen cannot load it, so one is enough to say no.
  const remote = viewers.filter((v) => v.surface === "web" && !v.local).length
  const reachable = remote === 0
  return {
    reachable,
    frameable: reachable,
    ...(reachable ? {} : { reason: `localhost is the agent's machine; ${remote} viewing page(s) are remote` }),
  }
}

export const PANEL_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "panel.show",
    async handle(payload, ctx) {
      const p = objectPayload(payload)
      const taskId = requireString(p, "taskId")
      const view = requireString(p, "view")
      if (!(PANEL_VIEWS as readonly string[]).includes(view))
        throw new Error(`view must be one of: ${PANEL_VIEWS.join(", ")}`)
      const rawUrl = optionalString(p, "url")
      const rawPath = optionalString(p, "path")
      if (rawUrl !== undefined && view !== "browser") throw new Error("url is for the browser view only")
      if (rawPath !== undefined && view === "browser") throw new Error("path is for the files and diff views only")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const url = rawUrl === undefined ? undefined : validUrl(rawUrl)
      const path = rawPath === undefined ? undefined : validPath(rawPath)
      ctx.bus.publish("panel.show", {
        taskId,
        view: view as (typeof PANEL_VIEWS)[number],
        ...(url ? { url: url.href } : {}),
        ...(path ? { path } : {}),
        at: Date.now(),
      })
      const all = ctx.rowStatus?.viewers() ?? []
      const viewers = all.filter((v) => v.taskId === taskId)
      return {
        // Web screens on the task with a panel open it; every attached web screen remembers it.
        shown: viewers.filter((v) => v.surface === "web" && v.panel).length,
        remembered: all.filter((v) => v.surface === "web").length,
        viewers,
        ...(url ? { url: await judgeUrl(url, viewers) } : {}),
      }
    },
  },
]
