/** `tab.new`: what the client may ask for, and the one verb each request becomes. */

import { flag, optShellLine } from "./ops/args.ts"
import type { Args } from "./ops/types.ts"
import { BridgeError, optBool, optStr } from "./protocol.ts"

/** What `tab.new` asks for: no `prompt` opens the tab empty (a shell, or an engine awaiting its first message). An engine starts in the task's own `tab-1` while the task has no conversation, else in a new child task sharing its directory; only then does the reply's `taskId` name the child. */
export interface NewTabRequest {
  readonly kind: "shell" | "engine"
  readonly prompt?: string
  /** A shell tab's first command line, typed with Enter. */
  readonly type?: string
  /** A shell tab that is the task's own first tab (New session's Shell), not a child row. */
  readonly own?: boolean
  /** Engine id for an engine tab; omitted = the task's own. */
  readonly engine?: string
  /** No engine named: the one this project used last (the TUI's ctrl+t), not the task's own. */
  readonly latest?: boolean
  /**
   * A DEAD engine tab whose slot the new engine takes (`send --tab <tab> --replace`): same task,
   * same tab id, the handoff brief built from that tab's conversation. `prompt` is then only the user's
   * own message (may be empty); the brief is not sent from the page.
   */
  readonly replaceTab?: string
}

/** A prompt starts the engine on it (`add --parent`, or `send --replace` for `replaceTab`); without one there is nothing to send, so `tab-new` opens the tab empty. */
export function newTabInvocation(
  taskId: string,
  tab: NewTabRequest,
): { readonly verb: "add" | "send" | "tab-new"; readonly argv: readonly string[] } {
  const command = tab.engine ? [flag("command", tab.engine)] : []
  if (tab.prompt === undefined && !tab.engine && tab.latest) command.push("--latest")
  if (tab.replaceTab !== undefined) {
    return {
      verb: "send",
      argv: [
        flag("task-id", taskId),
        flag("tab", tab.replaceTab),
        "--replace",
        "--plain",
        ...(tab.prompt ? [flag("prompt", tab.prompt)] : []),
        ...command,
      ],
    }
  }
  if (tab.prompt !== undefined) {
    return {
      verb: "add",
      argv: [flag("parent", taskId), "--no-worktree", flag("prompt", tab.prompt), ...command],
    }
  }
  const shell =
    tab.kind === "shell" ? [...(tab.type ? [flag("type", tab.type)] : []), ...(tab.own ? ["--own"] : [])] : []
  return { verb: "tab-new", argv: [flag("task-id", taskId), flag("kind", tab.kind), ...command, ...shell] }
}

/** The request as checked off the wire: a shell tab takes no prompt or engine, an engine tab no shell line. */
export function newTabRequest(a: Args): NewTabRequest {
  const prompt = optStr(a, "prompt")
  const kind = optStr(a, "kind") ?? "engine"
  if (kind !== "shell" && kind !== "engine") throw new BridgeError("BAD_ARGS", "kind is shell|engine")
  const engine = optStr(a, "engine")
  const latest = optBool(a, "latest")
  const replaceTab = optStr(a, "replaceTab")
  if (kind === "shell" && (prompt !== undefined || engine !== undefined || latest || replaceTab !== undefined)) {
    throw new BridgeError("BAD_ARGS", "a shell tab takes no prompt or engine")
  }
  if (replaceTab !== undefined && !/^tab-[A-Za-z0-9-]+$/.test(replaceTab)) {
    throw new BridgeError("BAD_ARGS", "replaceTab is not a tab id")
  }
  const type = kind === "shell" ? optShellLine(a, "type") : undefined
  return {
    kind,
    prompt,
    engine,
    ...(type ? { type } : {}),
    ...(kind === "shell" && optBool(a, "own") ? { own: true } : {}),
    ...(latest ? { latest } : {}),
    ...(replaceTab ? { replaceTab } : {}),
  }
}
