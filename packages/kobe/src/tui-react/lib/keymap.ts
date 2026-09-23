/**
 * React registration for key bindings; dispatch lives in
 * `src/tui/lib/keymap-dispatch.ts`. `config` is re-read on every keypress via
 * a ref; bindings stack LIFO and only the topmost enabled match fires.
 *
 * Mount effects run children before parents, so ANCESTORS land on top. A
 * parent and child sharing a chord must resolve by GATING the parent (e.g.
 * TerminalTabs' ctrl+w/F2 gate off while split so TerminalSplit's fire).
 * Modal barrier vs dialog body is declared via `ModalScopeContext` +
 * `modalOwner` and settled by `insertRegistration`, not by order.
 */

import { profileTick } from "@/lib/render-profile"
import type { KeyEvent, KeyHandler } from "@opentui/core"
import { flushSync, useRenderer } from "@opentui/react"
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react"
import { type CtrlHoldDetector, createCtrlHoldDetector } from "../../tui/lib/ctrl-hold"
import {
  type Binding,
  type BindingsConfig,
  type RegisteredBinding,
  armPrefixNow,
  currentPrefixConfiguration,
  dispatchKeyEvent,
  insertRegistration,
  invokeArmedPrefixAction,
  resetPrefixState,
} from "../../tui/lib/keymap-dispatch"
import { type BindingReachability, bindingReachability } from "../../tui/lib/keymap-reachability"
import { prefixHudHideDirect, prefixHudShowDirect } from "../../tui/lib/prefix-hud"
import { directGuideOptions } from "../../tui/lib/shortcut-reveal"
import { useLatest } from "../lib/use-latest"

export type { Binding, BindingsConfig } from "../../tui/lib/keymap-dispatch"

/**
 * Scope token set by the dialog overlay: `useBindings` inside it become
 * members, the barrier passes `modalOwner`, and `insertRegistration` puts
 * the barrier below its members whatever the commit order.
 */
export const ModalScopeContext = createContext<symbol | null>(null)

let nextId = 1
const stack: RegisteredBinding[] = []
// Production has one renderer; tests make one per test and need a rebind.
let installedRenderer: unknown = null
let installed: KeyHandler | null = null
let listener: ((evt: KeyEvent) => void) | null = null
let releaseListener: ((evt: KeyEvent) => void) | null = null
let ctrlHoldDetector: CtrlHoldDetector | null = null
/** Superseded renderers. Their trees can keep rendering after teardown
 *  (pending timers) and must not steal the listener back or wipe the stack. */
const supersededRenderers = new WeakSet<object>()

function ensureInstalled(renderer: ReturnType<typeof useRenderer>): void {
  if (!renderer) {
    throw new Error("useBindings: no renderer in scope; call inside a component rendered by @opentui/react.")
  }
  if (installedRenderer === renderer) return
  if (supersededRenderers.has(renderer as object)) return
  if (installed && listener) installed.off("keypress", listener)
  if (installed && releaseListener) installed.off("keyrelease", releaseListener)
  ctrlHoldDetector?.cancel()
  if (installedRenderer) supersededRenderers.add(installedRenderer as object)
  // Fresh stack: the old tree may die without React cleanups, and a
  // lingering modal barrier would block every key. Late cleanups splice by
  // id and no-op.
  stack.length = 0
  resetPrefixState()
  installedRenderer = renderer
  installed = renderer.keyInput
  ctrlHoldDetector = createCtrlHoldDetector({
    onReveal: () => {
      resetPrefixState()
      const options = directGuideOptions(bindingReachability(stack), currentPrefixConfiguration().key)
      if (options.length > 0) prefixHudShowDirect(options)
    },
    onHide: prefixHudHideDirect,
  })
  listener = (evt: KeyEvent) => {
    profileTick("key")
    ctrlHoldDetector?.keypress(evt)
    dispatchKeyEvent(stack, evt, Date.now(), {
      // OpenTUI renders synchronously on input; batched updates from this
      // non-React listener would commit after the paint and can drop the
      // just-updated subtree (a dialog body toggled by tab).
      flushSync,
    })
  }
  releaseListener = (evt: KeyEvent) => ctrlHoldDetector?.keyrelease(evt)
  installed.on("keypress", listener)
  installed.on("keyrelease", releaseListener)
}

/**
 * True while a modal barrier is registered. Raw `renderer.keyInput`
 * listeners (terminal IME/paste forwarder, sidebar search) bypass dispatch
 * and must check this, or dialog keystrokes land in the PTY/query behind.
 */
export function modalActive(): boolean {
  return stack.some((r) => r.modalOwner !== undefined)
}

/** Capture what F1 would have been able to dispatch before its modal opens. */
export function currentBindingReachability(): BindingReachability {
  return bindingReachability(stack)
}

/** Mouse path into the command layer: arm the prefix against the live stack. */
export function armPrefixFromCurrentStack(): boolean {
  return armPrefixNow(stack)
}

/** Click one entry from the currently armed local prefix reveal. */
export function invokeArmedPrefixActionFromCurrentStack(actionId: string, stroke: string): boolean {
  return invokeArmedPrefixAction(stack, actionId, stroke)
}

// Registrations land in effects after render and gates change with focus, so
// render output derived from the stack must subscribe. Each bump also closes
// an in-flight direct guide before it shows stale commands.
let stackVersion = 0
const stackListeners = new Set<() => void>()
function bumpStackVersion(): void {
  prefixHudHideDirect()
  stackVersion++
  for (const listener of stackListeners) listener()
}

function bindingReachabilitySignature(config: BindingsConfig): string {
  const bindings = config.bindings
    .map((binding) =>
      [
        binding.id ?? "",
        binding.key,
        binding.prefix === true ? "p" : "d",
        binding.passthrough === true ? "i" : "u",
      ].join(":"),
    )
    .join("|")
  return `${config.enabled === false ? "off" : "on"};${config.modal === true ? "modal" : "plain"};${bindings}`
}

/** Re-render when registrations or their current reachability change. */
export function useBindingStackVersion(): number {
  return useSyncExternalStore(
    (onChange) => {
      stackListeners.add(onChange)
      return () => stackListeners.delete(onChange)
    },
    () => stackVersion,
  )
}

/**
 * Register bindings for the component's lifetime. Scope and `modalOwner`
 * are read once at mount (stable for the provider's lifetime).
 */
export function useBindings(config: () => BindingsConfig, opts?: { modalOwner?: symbol }): void {
  const renderer = useRenderer()
  ensureInstalled(renderer)

  const configRef = useLatest(config)
  const scope = useContext(ModalScopeContext)
  const reachabilitySignature = bindingReachabilitySignature(config())
  const previousReachabilitySignature = useRef(reachabilitySignature)

  useEffect(() => {
    if (previousReachabilitySignature.current === reachabilitySignature) return
    previousReachabilitySignature.current = reachabilitySignature
    bumpStackVersion()
  }, [reachabilitySignature])

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once registration; scope/owner tokens are stable for the component's lifetime.
  useEffect(() => {
    // A superseded tree can mount late (a timer-opened dialog) past the stack
    // reset; one stale `modalOwner` would make `modalActive()` true forever
    // and silence the raw keyInput listeners.
    if (supersededRenderers.has(renderer as object)) return
    // Opening a Dialog Stack scope invalidates an in-flight prefix from the
    // surface behind it before any async/mouse transition can leak it back.
    if (opts?.modalOwner !== undefined) resetPrefixState()
    const reg: RegisteredBinding = {
      config: () => configRef.current(),
      id: nextId++,
      modalOwner: opts?.modalOwner,
      // The owner of a scope is not a member of it — it must sit below.
      modalMember: opts?.modalOwner === undefined ? (scope ?? undefined) : undefined,
    }
    insertRegistration(stack, reg)
    bumpStackVersion()
    return () => {
      const i = stack.findIndex((r) => r.id === reg.id)
      if (i >= 0) stack.splice(i, 1)
      bumpStackVersion()
    }
  }, [])
}

/** escape / q / ctrl+c → close, for standalone pages to spread into `bindings`. */
export function pageCloseBindings(cmd: () => void): Binding[] {
  return [
    { key: "escape", cmd },
    { key: "q", cmd },
    { key: "ctrl+c", cmd },
  ]
}
