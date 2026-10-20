/**
 * The user's `~/.rove/settings/keybindings.yaml` for a client that has no terminal to bind keys in:
 * what the TUI's parser makes of it (`resolveUserKeybindings`, run on a copy of the default keymap
 * so the bridge's own table never changes), the starter file Settings → Keybindings writes, and
 * firing a plugin action from a chord. The client never authors a chord target or a command: the
 * file is read on the Mac, the starter text is fixed, and an action runs only when the Mac's own
 * YAML binds the chord to it.
 */

import { roveCliInvocation } from "@sma1lboy/rove/src/cli/invocation.ts"
import { spawnDetached } from "@sma1lboy/rove/src/lib/spawn-detached.ts"
import {
  type KeybindingsFile,
  readKeybindingsFile,
  resetKeybindingsFileCache,
} from "@sma1lboy/rove/src/state/keybindings-file.ts"
import { RoveKeymap } from "@sma1lboy/rove/src/tui/context/keybindings-table.ts"
import { resolveUserKeybindings } from "@sma1lboy/rove/src/tui/lib/keybindings-resolve.ts"
import { createKeybindingsFile } from "@sma1lboy/rove/src/tui/lib/keybindings-starter.ts"
import { prefixFirstStrokes } from "@sma1lboy/rove/src/tui/lib/keymap-dispatch.ts"
import { BridgeError, str } from "../protocol.ts"
import type { Args, OpTable } from "./types.ts"

const CHORD_MAX = 64

export interface KeybindingsDeps {
  /** The YAML as the TUI reads it, from disk (never the process cache). */
  read(): KeybindingsFile
  /** Write the fixed starter text unless a file is there; false when one already is. */
  create(path: string): boolean
  /** Run `rove plugin action invoke <target>` detached, as the TUI's chord does; false when it would not start. */
  fireAction(target: string): boolean
  platform: NodeJS.Platform
}

const realDeps: KeybindingsDeps = {
  read() {
    resetKeybindingsFileCache()
    return readKeybindingsFile()
  },
  create: createKeybindingsFile,
  fireAction(target) {
    const [cmd, ...rest] = [...roveCliInvocation(), "plugin", "action", "invoke", target]
    return spawnDetached(cmd as string, rest, {
      onError: (err) => console.warn(`[rove/plugins] ${target}: ${String(err)}`),
    })
  },
  platform: process.platform,
}

interface RowOut {
  readonly id: string
  readonly keys: readonly string[]
  readonly prefixKeys?: readonly string[]
  readonly hint?: { readonly keys: string }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** A fresh, mutable copy of the default keymap: the parser edits rows in place. */
function copyKeymap(): Array<{
  id: string
  scope: string
  keys: readonly string[]
  prefixKeys?: readonly string[]
  hint?: { keys: string }
}> {
  return RoveKeymap.map((row) => ({
    id: row.id,
    scope: row.scope,
    keys: [...row.keys],
    ...(row.prefixKeys ? { prefixKeys: [...row.prefixKeys] } : {}),
    ...(row.hint ? { hint: { ...row.hint } } : {}),
  }))
}

export function createKeybindingsOps(deps: KeybindingsDeps = realDeps): OpTable {
  return {
    "keybindings.get": {
      kind: "read",
      destructive: false,
      wraps: "helper resolveUserKeybindings (the TUI's keybindings.yaml parser) on a copy of the default keymap",
      async run() {
        const file = deps.read()
        const rows = copyKeymap()
        const { report, prefix } = resolveUserKeybindings(file, rows, deps.platform)
        const changed: RowOut[] = []
        for (const row of rows) {
          const base = RoveKeymap.find((candidate) => candidate.id === row.id)
          if (base && same(base.keys, row.keys) && same(base.prefixKeys, row.prefixKeys) && same(base.hint, row.hint)) {
            continue
          }
          changed.push({
            id: row.id,
            keys: row.keys,
            ...(row.prefixKeys ? { prefixKeys: row.prefixKeys } : {}),
            ...(row.hint ? { hint: row.hint } : {}),
          })
        }
        return {
          path: report.path,
          exists: report.exists,
          rows: changed,
          prefix: { key: prefix.key, firstStrokes: prefixFirstStrokes(prefix), timeoutMs: prefix.timeoutMs },
          plugins: report.plugins,
          applied: report.applied,
          warnings: report.warnings,
        }
      },
    },

    "keybindings.createFile": {
      kind: "write",
      destructive: false,
      wraps: "helper createKeybindingsFile (the fixed, fully commented starter; never overwrites)",
      async run() {
        const file = deps.read()
        if (file.exists) return { path: file.path, created: false }
        return { path: file.path, created: deps.create(file.path) }
      },
    },

    "plugin.chordAction": {
      kind: "write",
      destructive: false,
      wraps:
        "rove plugin action invoke <target> (detached), only for an `action:` bound to this chord in keybindings.yaml",
      async run(a: Args) {
        const chord = str(a, "chord")
        if (chord.length > CHORD_MAX) throw new BridgeError("BAD_ARGS", "chord is too long")
        const file = deps.read()
        const { report } = resolveUserKeybindings(file, copyKeymap(), deps.platform)
        const bound = report.plugins.find((p) => p.chord === chord && p.kind === "action")
        if (!bound) throw new BridgeError("NOT_BOUND", `${chord} is not bound to a plugin action`)
        if (!deps.fireAction(bound.target)) {
          throw new BridgeError("SESSION_FAILED", `could not start plugin action ${bound.target}`)
        }
        return { target: bound.target }
      },
    },
  }
}

export const keybindingsOps: OpTable = createKeybindingsOps()
