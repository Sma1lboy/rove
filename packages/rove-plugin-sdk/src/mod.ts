/**
 * Sugar for a `[mod]` process: build trees with `Box`/`Text`/`Button`, show
 * them with `mod.pane()`, and get each button's `onPress` called when someone
 * presses it — in the TUI or the web, the host does not say which. Callbacks
 * stay in this process; only the JSON tree crosses the wire (see
 * `rove-daemon/plugins/mod-host.ts` for the line protocol).
 */

import type { Readable, Writable } from "node:stream"
import type { ModBox, ModButton, ModNode, ModSpace, ModText, ModTone } from "./mod-tree.ts"

/** A tree as the mod builds it: buttons still carry their callbacks. */
export type ModElement = ModBoxElement | ModText | ModButtonElement

export interface ModBoxElement extends Omit<ModBox, "children"> {
  readonly children: readonly ModElement[]
}

export interface ModButtonElement extends ModButton {
  readonly onPress?: () => void | Promise<void>
}

export interface BoxProps {
  readonly direction?: "row" | "column"
  readonly gap?: ModSpace
  readonly padding?: ModSpace
  readonly border?: boolean
  readonly children?: readonly ModElement[]
}

export function Box(props: BoxProps): ModBoxElement {
  const { children = [], ...rest } = props
  return { type: "box", ...rest, children }
}

export function Text(
  props: { readonly text: string; readonly tone?: ModTone; readonly bold?: boolean } | string,
): ModText {
  return typeof props === "string" ? { type: "text", text: props } : { type: "text", ...props }
}

export function Button(props: Omit<ModButtonElement, "type">): ModButtonElement {
  return { type: "button", ...props }
}

export interface Mod {
  /** Open or redraw one pane. Call it again whenever your state changes. */
  pane(id: string, title: string, tree: ModElement): void
  close(id: string): void
}

export interface RunModOptions {
  readonly input?: Readable
  readonly output?: Writable
  /** Where a throwing `onPress` is reported; the default is stderr (your plugin log). */
  readonly onError?: (err: unknown) => void
}

/** Split callbacks out of a tree, leaving the JSON a host validates. */
function strip(el: ModElement, presses: Map<string, () => void | Promise<void>>): ModNode {
  if (el.type === "button") {
    const { onPress, ...node } = el
    if (onPress) presses.set(el.key, onPress)
    return node
  }
  if (el.type === "box") return { ...el, children: el.children.map((child) => strip(child, presses)) }
  return el
}

export function runMod(opts: RunModOptions = {}): Mod {
  const input = opts.input ?? process.stdin
  const output = opts.output ?? process.stdout
  const onError = opts.onError ?? ((err: unknown) => console.error(err))
  const presses = new Map<string, Map<string, () => void | Promise<void>>>()
  const send = (msg: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(msg)}\n`)
  }

  let buf = ""
  input.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString()
    let nl = buf.indexOf("\n")
    while (nl >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      nl = buf.indexOf("\n")
      let msg: { type?: unknown; pane?: unknown; key?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.type !== "press" || typeof msg.pane !== "string" || typeof msg.key !== "string") continue
      const handler = presses.get(msg.pane)?.get(msg.key)
      if (!handler) continue
      try {
        Promise.resolve(handler()).catch(onError)
      } catch (err) {
        onError(err)
      }
    }
  })

  return {
    pane(id, title, tree) {
      const map = new Map<string, () => void | Promise<void>>()
      const node = strip(tree, map)
      presses.set(id, map)
      send({ type: "pane", id, title, tree: node })
    },
    close(id) {
      presses.delete(id)
      send({ type: "close", id })
    },
  }
}
