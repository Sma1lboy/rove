/**
 * `rove api panel-show` and `rove api viewers`: drive the web side panel (Files / Diff / Browser)
 * and learn what UI the human is in. The daemon validates, broadcasts on its `panel.show` channel
 * and answers from its `ui.viewing` registry; nothing here touches a browser.
 */

import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { ApiError, type VerbSpec } from "./types.ts"

const VIEWER_SHAPE =
  "{ viewer, surface: tui|web|phone, taskId, tabId?, panel (has a side panel: web desktop only), panelOpen?, narrow?, local (same machine as the daemon) }"

export const VIEWERS_VERB: VerbSpec = {
  name: "viewers",
  group: "read",
  summary: `Every UI attached and showing a task right now, so an agent knows what the human can see before it drives anything. Returns { viewers: [${VIEWER_SHAPE}] }. A TUI is surface tui (no panel, local). \`panel: true\` = a web page with a side panel, the only screen \`panel-show\` can open; \`local: false\` = behind a tunnel, so its \`localhost\` is not yours. An empty list = nobody is looking. --task-id keeps one task's viewers.`,
  flags: [F.taskId(false)],
  handler: (ctx) => simpleRpc(ctx, "ui.viewers", { taskId: ctx.args.str("task-id") }),
}

export const PANEL_SHOW_VERB: VerbSpec = {
  name: "panel-show",
  group: "drive",
  summary:
    "Bring up the web side panel on a view of a task: the Browser (--url), a file in the Files view or the Diff view (--path). Every web client remembers the view for the task; a web page currently on that task with a panel opens it (no focus steal, no task switch). A TUI has no panel: nothing happens there. Task defaults to $ROVE_TASK_ID, then the active task. Returns { shown (pages that open it now), remembered (web pages that keep it for later), viewers (as `viewers`, for the task), url? { reachable, frameable, reason? } }. `url.reachable: false` = a localhost URL and the viewer is remote; `url.frameable: false` = the site forbids framing (X-Frame-Options / CSP frame-ancestors) or was refused by the probe, so tell the human the link instead.",
  flags: [
    F.taskId(false),
    {
      name: "view",
      type: "enum",
      values: ["browser", "files", "diff"],
      required: true,
      description: "Which panel view to show.",
    },
    {
      name: "url",
      type: "string",
      placeholder: "URL",
      description: "Browser view: the http(s) page to load. Only localhost is framed over plain http.",
    },
    {
      name: "path",
      type: "string",
      placeholder: "FILE",
      description: "Files / Diff view: a file relative to the task's worktree (no `..`).",
    },
  ],
  handler: async (ctx) => {
    const taskId = ctx.args.str("task-id") ?? process.env.ROVE_TASK_ID ?? (await resolveActiveTaskId(daemonOf(ctx)))
    if (!taskId) {
      throw new ApiError("no target task: pass --task-id (no $ROVE_TASK_ID, no active task)", "MISSING_TARGET")
    }
    return simpleRpc(ctx, "panel.show", {
      taskId,
      view: ctx.args.str("view"),
      url: ctx.args.str("url"),
      path: ctx.args.str("path"),
    })
  },
}
