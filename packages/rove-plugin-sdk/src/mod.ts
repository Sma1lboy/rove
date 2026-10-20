/**
 * Sugar for a `[mod]` process: build trees with `Box`/`Text`/`Button`/`Input`,
 * show them with `mod.pane()`, and get each control's callback called when
 * someone uses it — in the TUI or the web, the host does not say which.
 * `mod.on()` subscribes to plugin events. Callbacks stay in this process; only
 * the JSON tree crosses the wire (see `rove-daemon/plugins/mod-host.ts` for
 * the line protocol).
 */

import type { Readable, Writable } from "node:stream"
import type { PluginEventEnvelope, PluginEventName } from "./contract.ts"
import type { ModBox, ModButton, ModInput, ModNode, ModSpace, ModText, ModTone } from "./mod-tree.ts"

/** A tree as the mod builds it: controls still carry their callbacks. */
export type ModElement = ModBoxElement | ModText | ModButtonElement | ModInputElement

export interface ModBoxElement extends Omit<ModBox, "children"> {
  readonly children: readonly ModElement[]
}

export interface ModButtonElement extends ModButton {
  readonly onPress?: () => void | Promise<void>
}

export interface ModInputElement extends ModInput {
  /** Enter in the field, from any client. */
  readonly onSubmit?: (value: string) => void | Promise<void>
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

export function Input(props: Omit<ModInputElement, "type">): ModInputElement {
  return { type: "input", ...props }
}

export interface Mod {
  /** Open or redraw one pane. Call it again whenever your state changes. */
  pane(id: string, title: string, tree: ModElement): void
  close(id: string): void
  /** Run `handler` on each plugin event of this name (same envelopes as `[[events]]` hooks). */
  on(event: PluginEventName, handler: (envelope: PluginEventEnvelope) => void | Promise<void>): void
}

export interface RunModOptions {
  readonly input?: Readable
  readonly output?: Writable
  /** Where a throwing callback is reported; the default is stderr (your plugin log). */
  readonly onError?: (err: unknown) => void
}

type Handler = (value: string) => void | Promise<void>

/** Split callbacks out of a tree, leaving the JSON a host validates. */
function strip(el: ModElement, handlers: Map<string, Handler>): ModNode {
  if (el.type === "button") {
    const { onPress, ...node } = el
    if (onPress) handlers.set(el.key, () => onPress())
    return node
  }
  if (el.type === "input") {
    const { onSubmit, ...node } = el
    if (onSubmit) handlers.set(el.key, onSubmit)
    return node
  }
  if (el.type === "box") return { ...el, children: el.children.map((child) => strip(child, handlers)) }
  return el
}

export function runMod(opts: RunModOptions = {}): Mod {
  const input = opts.input ?? process.stdin
  const output = opts.output ?? process.stdout
  const onError = opts.onError ?? ((err: unknown) => console.error(err))
  const controls = new Map<string, Map<string, Handler>>()
  const listeners = new Map<string, ((envelope: PluginEventEnvelope) => void | Promise<void>)[]>()
  const send = (msg: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(msg)}\n`)
  }
  const run = (fn: () => void | Promise<void>): void => {
    try {
      Promise.resolve(fn()).catch(onError)
    } catch (err) {
      onError(err)
    }
  }

  let buf = ""
  input.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString()
    let nl = buf.indexOf("\n")
    while (nl >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      nl = buf.indexOf("\n")
      let msg: { type?: unknown; pane?: unknown; key?: unknown; value?: unknown; event?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.type === "event") {
        const envelope = msg.event as PluginEventEnvelope | undefined
        for (const listener of listeners.get(envelope?.event ?? "") ?? [])
          run(() => listener(envelope as PluginEventEnvelope))
        continue
      }
      if (typeof msg.pane !== "string" || typeof msg.key !== "string") continue
      const handler = controls.get(msg.pane)?.get(msg.key)
      if (!handler) continue
      if (msg.type === "press") run(() => handler(""))
      else if (msg.type === "submit" && typeof msg.value === "string") run(() => handler(msg.value as string))
    }
  })

  return {
    pane(id, title, tree) {
      const map = new Map<string, Handler>()
      const node = strip(tree, map)
      controls.set(id, map)
      send({ type: "pane", id, title, tree: node })
    },
    close(id) {
      controls.delete(id)
      send({ type: "close", id })
    },
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      send({ type: "subscribe", events: [...listeners.keys()] })
    },
  }
}
