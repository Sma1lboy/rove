/**
 * Ops that open a tab running something the Mac resolves itself: a file in the user's configured
 * editor, a plugin pane, a viewport onto another task's session. Each is one `rove api tab-new`;
 * the client names a worktree-relative file, an installed pane or a task, never a command or an
 * executable. The editor comes from the Mac's own Settings, the pane's argv from its plugin manifest.
 */

import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { listPaneLaunches } from "@sma1lboy/rove-daemon/plugins/pane-command"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove/src/product.ts"
import { BridgeError, optStr, str } from "../protocol.ts"
import { flag, tabId, taskId } from "./args.ts"
import type { OpTable } from "./types.ts"

const PATH_MAX = 1000
const PANE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

interface PaneRow {
  readonly id: string
  readonly title: string
  readonly placement: "split" | "tab"
}

export const launchDeps = {
  /** Panes of enabled plugins, without their argv (that never leaves the Mac). */
  panes(): readonly PaneRow[] {
    return listPaneLaunches({ socketPath: defaultDaemonSocketPath(), binPath: ROVE_PRODUCT_NAME }).map((p) => ({
      id: `${p.pluginId}.${p.paneId}`,
      title: p.title,
      placement: p.placement,
    }))
  },
}

interface Opened {
  readonly tabId?: string
  readonly leaf?: string
}

async function tabNew(
  api: { verb<T>(n: string, a: readonly string[]): Promise<T> },
  id: string,
  kind: string,
  extra: readonly string[],
): Promise<Opened> {
  const res = await api.verb<Opened>("tab-new", [flag("task-id", id), flag("kind", kind), ...extra])
  if (!res.tabId) throw new BridgeError("SESSION_FAILED", "the new tab did not report its id")
  return { tabId: res.tabId, ...(res.leaf ? { leaf: res.leaf } : {}) }
}

export const launchOps: OpTable = {
  "file.openInEditor": {
    kind: "write",
    destructive: false,
    wraps: "rove api tab-new --kind editor (the Mac's configured editor on a file inside the task's worktree)",
    async run(a, { api }) {
      const rel = optStr(a, "path") ?? ""
      if (
        !rel ||
        rel.length > PATH_MAX ||
        rel.startsWith("/") ||
        rel.includes("\0") ||
        rel.split(/[\\/]/).includes("..")
      ) {
        throw new BridgeError("BAD_ARGS", "path must be relative to the worktree")
      }
      const { tabId: opened } = await tabNew(api, taskId(a), "editor", [flag("file", rel)])
      return { tabId: opened }
    },
  },

  "plugin.panes": {
    kind: "read",
    destructive: false,
    wraps: "helper listPaneLaunches (panes of enabled plugins)",
    async run() {
      return { panes: launchDeps.panes() }
    },
  },

  "plugin.paneOpen": {
    kind: "write",
    destructive: false,
    wraps: "rove api tab-new --kind pane (a registered plugin pane; its argv comes from the manifest)",
    async run(a, { api }) {
      const pane = str(a, "pane")
      if (!PANE_ID.test(pane)) throw new BridgeError("BAD_ARGS", "pane is not a plugin pane id")
      const extra = [flag("pane", pane)]
      if (a.tabId !== undefined && a.tabId !== null) extra.push(flag("tab", tabId(a)))
      return tabNew(api, taskId(a), "pane", extra)
    },
  },

  "tab.openViewport": {
    kind: "write",
    destructive: false,
    wraps: "rove api tab-new --kind viewport (a tab showing another task's first engine session)",
    async run(a, { api }) {
      const { tabId: opened } = await tabNew(api, taskId(a), "viewport", [flag("view-task", taskId(a, "viewTaskId"))])
      return { tabId: opened }
    },
  },
}
