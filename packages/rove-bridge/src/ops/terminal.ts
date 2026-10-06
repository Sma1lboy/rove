/**
 * Terminal-tab ops: per-tab state, rename, interrupt, handoff/fork, "ask the engine for a PR",
 * and image/PDF attachments. Each op wraps one `rove api` verb, one daemon RPC or one pure
 * Rove helper; the helpers that touch the filesystem or the engine transcripts are injected
 * so tests can fake them.
 */

import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { promptAttachmentsDir } from "@sma1lboy/rove/src/env.ts"
import { loadStateFile } from "@sma1lboy/rove/src/state/store.ts"
import {
  type ChatForkPlan,
  liveSourceProtocol,
  planWorktreeHandoff,
} from "@sma1lboy/rove/src/tui-react/workspace/fork-chat-tab.ts"
import { terminalTabsKey } from "@sma1lboy/rove/src/tui-react/workspace/terminal-tabs-persist.ts"
import { buildPRPrompt } from "@sma1lboy/rove/src/tui/ops/pr-prompt.ts"
import type { TerminalTab } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import { initialTabs } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-lifecycle.ts"
import type { VendorId } from "@sma1lboy/rove/src/types/vendor.ts"
import { BridgeError, optInt, optStr, str } from "../protocol.ts"
import { absPath, flag, optText, tabId, taskId, text } from "./args.ts"
import type { Args, OpTable } from "./types.ts"

/** What an attachment is worth to an engine: raw bytes on disk, named by magic number. */
const ATTACHMENT_TYPES = {
  "image/png": { ext: "png", kind: "image", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "image/jpeg": { ext: "jpg", kind: "image", magic: [0xff, 0xd8, 0xff] },
  "image/gif": { ext: "gif", kind: "image", magic: [0x47, 0x49, 0x46, 0x38] },
  "image/webp": { ext: "webp", kind: "image", magic: [0x52, 0x49, 0x46, 0x46] },
  "application/pdf": { ext: "pdf", kind: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
} as const

type AttachmentMime = keyof typeof ATTACHMENT_TYPES

/** Raw bytes; base64 plus the frame stays well under the socket's 8 MiB cap. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Same cap the TUI's attempts chip uses. */
const MAX_ATTEMPTS = 5

const PROMPT_MAX = 100_000

/** Everything with side effects outside the daemon, injectable for tests. */
export interface TerminalOpDeps {
  attachmentsDir(): string
  now(): Date
  nonce(): string
  writeFile(path: string, bytes: Uint8Array): void
  /** The persisted tab (carries `sessionId`), if the snapshot has it. */
  readTab(taskId: string, tabId: string): TerminalTab | undefined
  planHandoff(active: TerminalTab, source: VendorId, worktree: string): Promise<ChatForkPlan>
  prPrompt(worktree: string): Promise<string>
}

const realDeps: TerminalOpDeps = {
  attachmentsDir: promptAttachmentsDir,
  now: () => new Date(),
  nonce: () => randomBytes(4).toString("hex"),
  writeFile(path, bytes) {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 })
    writeFileSync(path, bytes, { mode: 0o600 })
  },
  readTab(task, tab) {
    const snapshot = loadStateFile()[terminalTabsKey(task)] as { tabs?: TerminalTab[] } | undefined
    return snapshot?.tabs?.find((t) => t.id === tab)
  },
  planHandoff: planWorktreeHandoff,
  prPrompt: buildPRPrompt,
}

/** A branch name git would accept and no flag parser could read as an option. */
function gitRef(args: Args, name: string): string {
  const v = args[name]
  const ok =
    typeof v === "string" &&
    v.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._/@+-]*$/.test(v) &&
    !v.includes("..") &&
    !v.includes("//") &&
    !v.endsWith("/") &&
    !v.endsWith(".") &&
    !v.endsWith(".lock") &&
    !v.includes("@{")
  if (!ok) throw new BridgeError("BAD_ARGS", `${name} is not a branch name`)
  return v
}

/** An engine id as `engine-list` reports it; never a command line. */
function engineId(args: Args, name = "engine"): string | undefined {
  const v = optStr(args, name)
  if (v === undefined) return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v)) throw new BridgeError("BAD_ARGS", `${name} is not an engine id`)
  return v
}

/** One line only: a tab name cannot carry a newline into the strip. */
function tabTitle(args: Args): string {
  const title = text(args, "title", 80).trim()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(title)) throw new BridgeError("BAD_ARGS", "title must be one line")
  return title
}

async function worktreeOf(api: { verb<T>(n: string, a: readonly string[]): Promise<T> }, id: string) {
  const res = await api.verb<{ task: SerializedTask }>("get-task", [flag("task-id", id)])
  if (!res.task.worktreePath) throw new BridgeError("NO_WORKTREE", `task ${id} has no worktree yet`)
  return { task: res.task, worktree: res.task.worktreePath }
}

/** Does `bytes` start like the declared type? A phone's label is not evidence. */
export function matchesMagic(mime: AttachmentMime, bytes: Uint8Array): boolean {
  const { magic } = ATTACHMENT_TYPES[mime]
  if (bytes.length < magic.length || !magic.every((b, i) => bytes[i] === b)) return false
  // RIFF is also WAV/AVI; WebP names itself at byte 8.
  return mime !== "image/webp" || Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
}

export function terminalOps(deps: TerminalOpDeps = realDeps): OpTable {
  return {
    "tab.states": {
      kind: "read",
      destructive: false,
      wraps: "daemon RPC debug.inspect (activity.tabs of one task)",
      async run(a, { api }) {
        const id = taskId(a)
        const res = await api.rpc<{
          activity?: { tabs?: Record<string, Record<string, { state?: unknown; at?: unknown }>> }
        }>("debug.inspect")
        const tabs: Record<string, { state: string; at: number }> = {}
        for (const [tab, entry] of Object.entries(res?.activity?.tabs?.[id] ?? {})) {
          if (typeof entry?.state === "string" && typeof entry.at === "number") {
            tabs[tab] = { state: entry.state, at: entry.at }
          }
        }
        return { tabs }
      },
    },

    "tab.rename": {
      kind: "write",
      destructive: false,
      wraps: "rove api rename --tab",
      async run(a, { api }) {
        await api.verb("rename", [flag("task-id", taskId(a)), flag("tab", tabId(a)), flag("title", tabTitle(a))])
        return {}
      },
    },

    "tab.interrupt": {
      kind: "write",
      destructive: false,
      wraps: "rove api interrupt",
      async run(a, { api }) {
        const argv = [flag("task-id", taskId(a))]
        if (a.tabId !== undefined && a.tabId !== null) argv.push(flag("tab", tabId(a)))
        await api.verb("interrupt", argv)
        return {}
      },
    },

    "tab.forkTask": {
      kind: "write",
      destructive: false,
      wraps: "rove api add --base-branch (--count for attempts)",
      async run(a, { api }) {
        const count = optInt(a, "count", 1, MAX_ATTEMPTS) ?? 1
        const argv = [
          flag("repo", absPath(a, "repo")),
          flag("base-branch", gitRef(a, "baseBranch")),
          flag("prompt", text(a, "prompt", PROMPT_MAX)),
        ]
        const engine = engineId(a)
        if (engine) argv.push(flag("command", engine))
        const title = optText(a, "title", 200)
        if (title) argv.push(flag("title", title))
        if (count > 1) argv.push(flag("count", count))
        const res = await api.verb<{ taskId?: string; tasks?: ReadonlyArray<{ taskId: string }> }>("add", argv)
        const taskIds = res.tasks ? res.tasks.map((t) => t.taskId) : res.taskId ? [res.taskId] : []
        if (taskIds.length === 0) throw new BridgeError("ADD_FAILED", "no task was created")
        return { taskIds }
      },
    },

    "tab.handoff": {
      kind: "read",
      destructive: false,
      wraps: "planWorktreeHandoff (transcript handoff prompt)",
      async run(a, { api }) {
        const id = taskId(a)
        const tab = tabId(a)
        const { task, worktree } = await worktreeOf(api, id)
        // A snapshot-less tab still has a conversation: the planner falls back to the engine's newest session here.
        const active = deps.readTab(id, tab) ?? (initialTabs().tabs[0] as TerminalTab)
        const tabVendor = ((active.kind === "engine" ? active.vendor : undefined) ?? task.vendor) as VendorId
        const plan = await deps.planHandoff(active, liveSourceProtocol(active, tabVendor), worktree)
        return plan.kind === "handoff"
          ? { kind: "handoff", prompt: plan.prompt }
          : plan.kind === "no-transcript"
            ? { kind: plan.kind, engine: plan.engine }
            : { kind: plan.kind }
      },
    },

    "tab.requestPR": {
      kind: "write",
      destructive: false,
      wraps: "buildPRPrompt + rove api send --plain",
      async run(a, { api }) {
        const id = taskId(a)
        const { worktree } = await worktreeOf(api, id)
        const argv = [flag("task-id", id), "--plain", flag("prompt", await deps.prPrompt(worktree))]
        if (a.tabId !== undefined && a.tabId !== null) argv.push(flag("tab", tabId(a)))
        await api.verb("send", argv)
        return {}
      },
    },

    "attachment.put": {
      kind: "write",
      destructive: false,
      wraps: "writes ~/.rove/attachments/<generated name> (tui/lib/attachments.ts layout)",
      async run(a) {
        const mime = str(a, "mime")
        if (!Object.hasOwn(ATTACHMENT_TYPES, mime)) {
          throw new BridgeError("BAD_ARGS", `mime must be one of ${Object.keys(ATTACHMENT_TYPES).join("|")}`)
        }
        const type = ATTACHMENT_TYPES[mime as AttachmentMime]
        const encoded = str(a, "data")
        // Bound the work before decoding: base64 is 4 bytes per 3.
        if (encoded.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4) {
          throw new BridgeError("TOO_LARGE", `attachment is larger than ${MAX_ATTACHMENT_BYTES} bytes`)
        }
        const bytes = Buffer.from(encoded, "base64")
        if (bytes.length === 0) throw new BridgeError("BAD_ARGS", "data is empty")
        if (bytes.length > MAX_ATTACHMENT_BYTES) {
          throw new BridgeError("TOO_LARGE", `attachment is larger than ${MAX_ATTACHMENT_BYTES} bytes`)
        }
        if (!matchesMagic(mime as AttachmentMime, bytes)) {
          throw new BridgeError("BAD_ARGS", `data is not a ${type.ext} file`)
        }
        const stamp = deps.now().toISOString().slice(0, 10).replaceAll("-", "")
        const path = join(deps.attachmentsDir(), `attach-${stamp}-${deps.nonce()}.${type.ext}`)
        deps.writeFile(path, bytes)
        return { path, kind: type.kind, bytes: bytes.length }
      },
    },
  }
}

export const TERMINAL_OPS: OpTable = terminalOps()
