/**
 * A task's worktree files for the side panel's Browser (`rove api panel-show --view browser --path`):
 * `/worktree/<taskId>/<key>/<path>`. An iframe cannot present the bridge token, so the URL carries a
 * key instead: an HMAC of the token and the task, which only an authenticated socket is handed (in its
 * `panel` push) and which opens that one task's worktree. Served with a CSP sandbox and no
 * `allow-same-origin`: the agent's page runs in an opaque origin, never as the Rove page that holds
 * the token.
 */

import { createHmac } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { join, sep } from "node:path"
import { tokenMatches } from "./auth.ts"
import { flag } from "./ops/args.ts"
import type { BridgeApi } from "./ops/types.ts"

const PREFIX = "/worktree/"

const HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  // The sandboxed page's origin is opaque, so its module scripts and fetches of siblings are cross-origin.
  "Access-Control-Allow-Origin": "*",
}

function keyOf(token: string, taskId: string): string {
  return createHmac("sha256", token).update(`worktree:${taskId}`).digest("base64url")
}

/** The page-relative address of a worktree file. */
export function worktreeFileUrl(token: string, taskId: string, path: string): string {
  const rel = path.split("/").map(encodeURIComponent).join("/")
  return `${PREFIX}${encodeURIComponent(taskId)}/${keyOf(token, taskId)}/${rel}`
}

/** A `panel.show` for a worktree file in the Browser, with the address it is served at. */
export function withPageUrl<P extends { taskId: string; view: string; path?: string }>(token: string, p: P): P {
  return p.view === "browser" && p.path ? { ...p, url: worktreeFileUrl(token, p.taskId, p.path) } : p
}

const notFound = () => new Response("not found\n", { status: 404, headers: { "Cache-Control": "no-store" } })

/** The file, a refusal, or null when `req` is not for this route. */
export async function serveWorktreeFile(
  req: Request,
  deps: { readonly token: string; readonly api: BridgeApi },
): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(PREFIX)) return null
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed\n", { status: 405 })
  const [rawTask = "", key = "", ...rest] = url.pathname.slice(PREFIX.length).split("/")
  let taskId: string
  let segments: string[]
  try {
    taskId = decodeURIComponent(rawTask)
    segments = rest.map(decodeURIComponent)
  } catch {
    return notFound()
  }
  if (!taskId || !tokenMatches(keyOf(deps.token, taskId), key)) {
    return new Response("unauthorized\n", { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  if (
    segments.length === 0 ||
    segments.some((s) => s === "" || s === "." || s === ".." || s === ".git" || /[\0\\/]/.test(s))
  ) {
    return notFound()
  }
  // Another machine's worktree is not on this disk.
  if (deps.api.machineOf?.(taskId) !== undefined) return notFound()
  let root: string
  try {
    const got = await deps.api.verb<{ task: { worktreePath?: string | null } }>("get-task", [flag("task-id", taskId)])
    if (!got.task.worktreePath) return notFound()
    root = await realpath(got.task.worktreePath)
  } catch {
    return notFound()
  }
  // Symlinks are followed, then the target must still be inside the worktree.
  const target = await realpath(join(root, ...segments)).catch(() => null)
  if (!target || !target.startsWith(root + sep)) return notFound()
  if (
    !(await stat(target).then(
      (s) => s.isFile(),
      () => false,
    ))
  )
    return notFound()
  const file = Bun.file(target)
  return new Response(req.method === "HEAD" ? null : file, { headers: { ...HEADERS, "Content-Type": file.type } })
}
