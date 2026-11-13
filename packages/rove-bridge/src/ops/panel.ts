/**
 * The Browser panel's reads. `browser.probe`: can this page be framed? One HTTPS HEAD, through the
 * same narrow probe `rove api panel-show` uses (`rove-daemon/src/daemon/frame-check.ts`): private
 * addresses refused, no redirect followed, 3 seconds. `browser.ports`: which of a task's listening
 * ports serve a page.
 */

import { checkFrame } from "@sma1lboy/rove-daemon/daemon/frame-check"
import { BridgeError } from "../protocol.ts"
import { flag, taskId } from "./args.ts"
import type { BridgeApi, OpTable } from "./types.ts"

const URL_MAX = 2048
const PAGE_TIMEOUT_MS = 1500

interface Listener {
  readonly port: number
  readonly host: string
  readonly pid: number
  readonly url: string
}

export interface PagePort {
  readonly port: number
  readonly url: string
}

/** Does GET / on this listener answer with HTML? Undefined = no answer yet (still starting, or not HTTP). */
async function servesPage(l: Listener): Promise<boolean | undefined> {
  // A wildcard or loopback bind is probed on loopback itself: `localhost` may resolve to the other family.
  const local = l.url.startsWith("http://localhost:")
  const target = local ? `http://${l.host.includes(":") ? "[::1]" : "127.0.0.1"}:${l.port}/` : l.url
  try {
    const res = await fetch(target, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
    void res.body?.cancel()
    return (res.headers.get("content-type") ?? "").includes("text/html")
  } catch {
    return undefined
  }
}

// A listener's answer does not change while its process lives, so each is asked once.
const answered = new Map<string, boolean>()

/**
 * The ports of a task that a browser can show: its processes' listeners that serve HTML, one row per
 * port. An engine's own listeners, debuggers and databases answer no page and are left out.
 */
export async function pagePorts(api: BridgeApi, id: string, probe = servesPage, seen = answered): Promise<PagePort[]> {
  // The probe runs on this machine; another machine's listeners are not reachable from here.
  if (api.machineOf?.(id) !== undefined) return []
  const res = await api.verb<{ ports?: readonly Listener[] | null }>("ports", [flag("task-id", id)])
  const pages = new Map<number, PagePort>()
  await Promise.all(
    (res.ports ?? []).map(async (l) => {
      const key = `${l.pid}:${l.port}`
      const page = seen.get(key) ?? (await probe(l))
      if (page === undefined) return
      seen.set(key, page)
      if (page) pages.set(l.port, { port: l.port, url: l.url })
    }),
  )
  return [...pages.values()].sort((a, b) => a.port - b.port)
}

export const panelOps: OpTable = {
  "browser.probe": {
    kind: "read",
    destructive: false,
    wraps: "frame probe (HTTPS HEAD to a public address; reads X-Frame-Options and CSP frame-ancestors)",
    async run(a) {
      const { url, origin } = a
      if (typeof url !== "string" || url.length === 0 || url.length > URL_MAX) {
        throw new BridgeError("BAD_ARGS", "url must be a URL string")
      }
      if (origin !== undefined && (typeof origin !== "string" || origin.length > URL_MAX)) {
        throw new BridgeError("BAD_ARGS", "origin must be the page's origin string")
      }
      return checkFrame(url, origin === undefined ? {} : { origin })
    },
  },

  "browser.ports": {
    kind: "read",
    destructive: false,
    wraps: "rove api ports --task-id, kept to the listeners whose GET / answers HTML: `{ports: [{port, url}]}`",
    async run(a, { api }) {
      return { ports: await pagePorts(api, taskId(a)) }
    },
  },
}
