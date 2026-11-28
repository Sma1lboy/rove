/**
 * `rove api web <tab|nav|snap|batch|eval|fetch|handoff>`: drive `rove-desktop`'s native
 * `WebContentsView` side-panel browser over its local owner-only IPC socket.
 *
 * Accepts both positional subcommands (`rove api web snap --interactive --root @e1`,
 * `rove api web tab handoff b-1`) and canonical `--action` flags so `schema`, `--help`,
 * `api-flags.md` generation, and `api.invoke` all share one spec.
 */

import { readFileSync } from "node:fs"
import { F } from "./flags.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"
import { requestDesktopBrowser } from "./web-ipc.ts"

const WEB_ACTIONS = ["tab", "nav", "snap", "batch", "eval", "fetch", "handoff"] as const
type WebAction = (typeof WEB_ACTIONS)[number]

const TAB_ACTIONS = ["list", "new", "close", "focus", "handoff"] as const
type TabAction = (typeof TAB_ACTIONS)[number]

const NAV_GO = ["back", "forward", "reload"] as const
const WEB_BOOL_FLAGS = new Set(["interactive", "await", "pretty", "help", "envelope"])

/**
 * Rewrite positional subcommand shorthand (`web snap --interactive`, `web tab handoff b-1`,
 * `web eval --id b-1 "document.title"`) into canonical `--flag` tokens before `parseFlags`.
 * Flags may appear before or after positional arguments.
 */
export function normalizeWebArgv(argv: readonly string[]): readonly string[] {
  const first = argv[0]
  if (!first || first.startsWith("-")) return argv
  if (!(WEB_ACTIONS as readonly string[]).includes(first)) return argv
  const action = first as WebAction
  const positionals: string[] = []
  const flags: string[] = []

  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i]!
    if (tok === "-h" || tok.startsWith("--")) {
      flags.push(tok)
      if (tok !== "-h" && !tok.includes("=")) {
        const key = tok.slice(2)
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith("--")) {
          if (!WEB_BOOL_FLAGS.has(key) || next === "true" || next === "false" || next === "1" || next === "0") {
            flags.push(next)
            i += 1
          }
        }
      }
    } else {
      positionals.push(tok)
    }
  }

  const out: string[] = ["--action", action]
  const [p0, p1, ...restPos] = positionals
  if (action === "tab") {
    if (p0) out.push("--tab-action", p0)
    if (p1) {
      if (p0 === "new") out.push("--url", p1)
      else if (p0 === "close" || p0 === "focus" || p0 === "handoff") out.push("--id", p1)
      else out.push(p1)
    }
    out.push(...restPos)
  } else if (action === "handoff") {
    if (p0) out.push("--id", p0)
    if (p1) out.push(p1)
    out.push(...restPos)
  } else if (action === "nav") {
    if (p0) {
      if ((NAV_GO as readonly string[]).includes(p0)) out.push("--go", p0)
      else out.push("--url", p0)
    }
    if (p1) out.push(p1)
    out.push(...restPos)
  } else if (action === "eval") {
    if (p0) out.push("--expr", p0)
    if (p1) out.push(p1)
    out.push(...restPos)
  } else if (action === "batch") {
    if (p0) out.push("--steps", p0)
    if (p1) out.push(p1)
    out.push(...restPos)
  } else if (action === "fetch") {
    if (p0) out.push("--url", p0)
    if (p1) out.push(p1)
    out.push(...restPos)
  } else {
    out.push(...positionals)
  }

  out.push(...flags)
  return out
}

function parseJsonFlag<T>(raw: string, flagName: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new ApiError(
      `--${flagName} must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      "BAD_FLAG",
      helpStep("web"),
    )
  }
}

function readBatchSteps(ctx: VerbContext): unknown[] {
  const inline = ctx.args.str("steps")
  const file = ctx.args.str("steps-file")
  if (inline && file) throw new ApiError("pass either --steps or --steps-file, not both", "BAD_FLAG", helpStep("web"))
  let raw = inline
  if (file) {
    if (!ctx.caller.cli && file === "-") {
      throw new ApiError("--steps-file - requires CLI stdin", "BAD_FLAG", helpStep("web"))
    }
    try {
      raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8")
    } catch (err) {
      throw new ApiError(
        `could not read --steps-file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        "BAD_FLAG",
        helpStep("web"),
      )
    }
  }
  if (!raw) throw new ApiError("batch requires --steps JSON (or --steps-file PATH)", "MISSING_FLAG", helpStep("web"))
  const parsed = parseJsonFlag<unknown>(raw, file ? "steps-file" : "steps")
  if (!Array.isArray(parsed)) {
    throw new ApiError("batch steps must be a JSON array", "BAD_FLAG", helpStep("web"))
  }
  return parsed
}

export const WEB_VERB: VerbSpec = {
  name: "web",
  group: "drive",
  offline: true,
  summary:
    "Drive `rove-desktop`'s native `WebContentsView` side-panel browser over local IPC: `tab` (list/new/close/focus/handoff), `nav`, `snap` (compact accessibility/interactive snapshot with `@eN` refs), `batch` (multi-step actions), `eval`, `fetch` (authenticated via the tab's persistent session), and `handoff` (pass a live logged-in tab between human and agent). Accepts positional shorthand (`rove api web snap --interactive --root @e1`, `rove api web tab handoff b-1`) or `--action`. Fails with `DESKTOP_UNAVAILABLE` when `rove-desktop` is not running.",
  flags: [
    {
      name: "action",
      type: "enum",
      values: WEB_ACTIONS,
      required: true,
      placeholder: "SUBCMD",
      description: "Browser command: tab, nav, snap, batch, eval, fetch, or handoff (also accepted positionally).",
    },
    {
      name: "tab-action",
      type: "enum",
      values: TAB_ACTIONS,
      default: "list",
      description: "With `tab`: list, new, close, focus, or handoff (also accepted as second positional arg).",
    },
    {
      name: "id",
      type: "string",
      placeholder: "ID",
      description: "Target browser tab id (e.g. b-1 from `tab list`). Defaults to the task's or active browser tab.",
    },
    F.taskId(false),
    {
      name: "url",
      type: "string",
      placeholder: "URL",
      description: "HTTP(S) address for `nav`, `tab new`, or `fetch` (relative URLs allowed for `fetch`).",
    },
    {
      name: "go",
      type: "enum",
      values: NAV_GO,
      description: "With `nav`: real Chromium history step (`back`, `forward`) or `reload`.",
    },
    {
      name: "wait-until",
      type: "enum",
      values: ["load", "domcontentloaded", "none"],
      default: "load",
      description: "With `nav` / `tab new`: wait for `load`, `domcontentloaded`, or return immediately (`none`).",
    },
    {
      name: "interactive",
      type: "bool",
      description: "With `snap`: include only interactive elements (buttons, links, inputs, tabs, controls).",
    },
    {
      name: "root",
      type: "string",
      placeholder: "@eN",
      description: "With `snap`: scope the snapshot to the subtree rooted at ref `@eN` from a prior `snap`.",
    },
    {
      name: "max-nodes",
      type: "int",
      placeholder: "N",
      description: "With `snap`: maximum nodes returned (default 250, cap 1000).",
    },
    {
      name: "expr",
      type: "string",
      placeholder: "JS",
      description: "With `eval`: JavaScript expression evaluated in the live page (awaited by default).",
    },
    {
      name: "await",
      type: "bool",
      default: "true",
      description: "With `eval`: await returned Promises (`--await false` disables).",
    },
    {
      name: "steps",
      type: "string",
      placeholder: "JSON",
      description:
        "With `batch`: JSON array of steps ({action: nav|click|fill|type|press|select|check|hover|focus|scroll|wait|eval|snap, ...}).",
    },
    {
      name: "steps-file",
      type: "string",
      placeholder: "PATH",
      description: "With `batch`: read the JSON steps array from PATH (`-` = stdin).",
    },
    {
      name: "method",
      type: "string",
      default: "GET",
      placeholder: "VERB",
      description: "With `fetch`: HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD).",
    },
    {
      name: "headers",
      type: "string",
      placeholder: "JSON",
      description: "With `fetch`: JSON object of request headers.",
    },
    {
      name: "body",
      type: "string",
      placeholder: "TEXT",
      description: "With `fetch`: request body string.",
    },
    {
      name: "owner",
      type: "enum",
      values: ["human", "agent"],
      description: "With `handoff` / `tab handoff` / `tab new`: set tab owner (handoff toggles when omitted).",
    },
    {
      name: "reason",
      type: "string",
      placeholder: "TEXT",
      description: "With `handoff` / `tab handoff`: short note shown when handing control over.",
    },
    {
      name: "timeout",
      type: "int",
      placeholder: "MS",
      description: "Timeout in milliseconds for navigation or IPC calls.",
    },
  ],
  handler: async (ctx) => {
    const action = ctx.args.requireEnum<WebAction>("action")
    const id = ctx.args.str("id")
    const taskId = ctx.args.str("task-id") ?? process.env.ROVE_TASK_ID
    const timeoutMs = ctx.args.int("timeout")
    const rpcOpts = timeoutMs !== undefined ? { timeoutMs: Math.max(timeoutMs + 2_000, 5_000) } : undefined

    switch (action) {
      case "tab": {
        const sub = (ctx.args.str("tab-action") ?? "list") as TabAction
        if (sub === "list") return requestDesktopBrowser("tab.list", { taskId }, rpcOpts)
        if (sub === "new") {
          return requestDesktopBrowser(
            "tab.new",
            {
              url: ctx.args.str("url"),
              taskId,
              owner: ctx.args.str("owner"),
              waitUntil: ctx.args.str("wait-until"),
              timeoutMs,
            },
            rpcOpts,
          )
        }
        if (sub === "close") {
          if (!id) throw new ApiError("tab close requires --id", "MISSING_FLAG", helpStep("web"))
          return requestDesktopBrowser("tab.close", { id, taskId }, rpcOpts)
        }
        if (sub === "focus") {
          if (!id) throw new ApiError("tab focus requires --id", "MISSING_FLAG", helpStep("web"))
          return requestDesktopBrowser("tab.focus", { id, taskId }, rpcOpts)
        }
        return requestDesktopBrowser(
          "tab.handoff",
          { id, taskId, owner: ctx.args.str("owner"), reason: ctx.args.str("reason") },
          rpcOpts,
        )
      }
      case "handoff":
        return requestDesktopBrowser(
          "tab.handoff",
          { id, taskId, owner: ctx.args.str("owner"), reason: ctx.args.str("reason") },
          rpcOpts,
        )
      case "nav": {
        const url = ctx.args.str("url")
        const go = ctx.args.str("go")
        if (!url && !go)
          throw new ApiError("nav requires --url or --go back|forward|reload", "MISSING_FLAG", helpStep("web"))
        return requestDesktopBrowser(
          "nav",
          { id, taskId, url, go, waitUntil: ctx.args.str("wait-until"), timeoutMs },
          rpcOpts,
        )
      }
      case "snap":
        return requestDesktopBrowser(
          "snap",
          {
            id,
            taskId,
            interactive: ctx.args.bool("interactive") === true,
            root: ctx.args.str("root"),
            maxNodes: ctx.args.int("max-nodes"),
          },
          rpcOpts,
        )
      case "eval": {
        const expr = ctx.args.str("expr")
        if (!expr) throw new ApiError("eval requires --expr", "MISSING_FLAG", helpStep("web"))
        return requestDesktopBrowser(
          "eval",
          { id, taskId, expr, awaitPromise: ctx.args.bool("await") !== false },
          rpcOpts,
        )
      }
      case "batch":
        return requestDesktopBrowser("batch", { id, taskId, steps: readBatchSteps(ctx) }, rpcOpts)
      case "fetch": {
        const url = ctx.args.str("url")
        if (!url) throw new ApiError("fetch requires --url", "MISSING_FLAG", helpStep("web"))
        const headersRaw = ctx.args.str("headers")
        const headers = headersRaw ? parseJsonFlag<unknown>(headersRaw, "headers") : undefined
        if (headers !== undefined && (typeof headers !== "object" || headers === null || Array.isArray(headers))) {
          throw new ApiError("--headers must be a JSON object", "BAD_FLAG", helpStep("web"))
        }
        return requestDesktopBrowser(
          "fetch",
          {
            id,
            taskId,
            url,
            method: ctx.args.str("method"),
            ...(headers ? { headers } : {}),
            ...(ctx.args.str("body") !== undefined ? { body: ctx.args.str("body") } : {}),
          },
          rpcOpts,
        )
      }
    }
  },
}
