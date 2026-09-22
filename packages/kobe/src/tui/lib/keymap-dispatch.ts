/**
 * Framework-free keymap dispatch, so tests cover binding-stack precedence and
 * preventDefault without a renderer. `src/tui-react/lib/keymap.ts` owns the
 * React hook + renderer install and re-exports from here.
 */

import type { KeyEvent } from "@opentui/core"
import { isDev } from "../../env.ts"
import { matchKey } from "./keymap-match"
import { inputPassthroughReachable, prefixReachable, scanReachability } from "./keymap-reachability"
import { isKittyModifierKeyName } from "./modifier-keys"
import { type PrefixHudOption, prefixHudPush, prefixHudSetArmed } from "./prefix-hud"

// Re-exported for `test/bench/hot-paths.bench.ts`, which benches the public door.
export { matchKey } from "./keymap-match"

/** Mouse-safe command paired with a keyboard binding. */
export type PrefixAction = Readonly<{ run: () => void }>

/** Mark a handler as safe to invoke from a clickable prefix entry. */
export function prefixAction(run: () => void): PrefixAction {
  return { run }
}

export type Binding = {
  key: string
  /** True when `key` is the second stroke of the PureTUI prefix. */
  prefix?: boolean
  /** Terminal/shell input that marks the PTY boundary. The configured prefix remains Kobe-owned. */
  passthrough?: boolean
  /** Skip this match when the current input surface forwards keys to a PTY. */
  yieldToPassthrough?: boolean
  /** Owning KobeKeymap id, filled by `bindByIds` so the prefix HUD can name the action. Hand-rolled literals may omit it. */
  id?: string
  /**
   * `slot` is present when the registration assigned one (`bindByIds` does).
   * Multiplexed handlers (direction decided by WHICH chord fired) read it
   * instead of `event.name`, so user-rebound chords keep working.
   */
  cmd: (event: KeyEvent, slot?: number) => void
  /** Typed command used by the local prefix reveal; never synthesizes a KeyEvent. */
  action?: PrefixAction
  /**
   * Index of `key` in the owning id's `keys` at registration; `bindByIds`
   * fills it. Lets `sidebar.nav` map chord → direction without `event.name`,
   * which is what makes multiplexed ids rebindable (SLOT_CONTRACTS in
   * keymap-overrides.ts).
   */
  slot?: number
}

export type BindingsConfig = {
  enabled?: boolean
  /**
   * Modal barrier: if none of ITS bindings matched, the walk STOPS, so every
   * older entry is unreachable. `preventDefault` is NOT called, so the
   * dialog's focused input still gets the key. This is the structural
   * guarantee that a dialog can't operate the UI behind it.
   */
  modal?: boolean
  bindings: Binding[]
}

export type RegisteredBinding = {
  config: () => BindingsConfig
  id: number
  /**
   * Static modal-scope declaration, never re-read per keypress. With
   * {@link insertRegistration} it makes barrier-vs-body precedence DECLARED
   * DATA instead of React effect-commit order:
   *   - `modalOwner`: this entry IS the barrier for that scope. Its `config()`
   *     should also return `modal: true` (owner = stack POSITION, `config.modal`
   *     = dispatch cut-off).
   *   - `modalMember`: inside that scope (a dialog body); stays above the barrier.
   */
  modalOwner?: symbol
  modalMember?: symbol
}

/**
 * Plain entries push (LIFO). A modal OWNER goes BELOW the lowest registered
 * MEMBER of its scope, so members beat the barrier and the barrier still cuts
 * off everything older, whichever order React commits the effects in (see
 * tui-react/ui/dialog.tsx). O(n) only at mount/unmount, never per keypress.
 */
export function insertRegistration(stack: RegisteredBinding[], reg: RegisteredBinding): void {
  if (reg.modalOwner !== undefined) {
    const firstMember = stack.findIndex((r) => r.modalMember === reg.modalOwner)
    if (firstMember >= 0) {
      stack.splice(firstMember, 0, reg)
      return
    }
  }
  stack.push(reg)
}

/**
 * Re-entrancy guard: a `cmd()` can mount/unmount components that synchronously
 * dispatch keys, and a nested dispatch would scan a stack mid-mutation. One
 * physical keypress resolves to at most one binding, so nested dispatches drop.
 */
let dispatching = false

export type PrefixConfiguration = {
  /** First stroke; null disables PureTUI prefix dispatch. */
  key: string | null
  /** Maximum elapsed milliseconds between the two strokes. */
  timeoutMs: number
}

export const DEFAULT_PREFIX_CONFIGURATION: Readonly<PrefixConfiguration> = { key: "ctrl+a", timeoutMs: 5000 }

let prefixConfiguration: PrefixConfiguration = { ...DEFAULT_PREFIX_CONFIGURATION }
let prefixArmedAt: number | null = null
let prefixArmedOnPassthrough = false
let prefixArmedOptions: readonly PrefixHudOption[] = []
let prefixTimer: ReturnType<typeof setTimeout> | null = null

/** Apply a validated configuration and cancel an in-flight sequence. */
export function configurePrefix(next: PrefixConfiguration): void {
  prefixConfiguration = { ...next }
  resetPrefixState()
}

/** Restore the built-in PureTUI prefix configuration. */
export function resetPrefixConfiguration(): void {
  prefixConfiguration = { ...DEFAULT_PREFIX_CONFIGURATION }
  resetPrefixState()
}

/** Current PureTUI prefix configuration for help and shortcut displays. */
export function currentPrefixConfiguration(): Readonly<PrefixConfiguration> {
  return prefixConfiguration
}

/** Cancel a prefix sequence when reload, a modal, or teardown intervenes. */
export function resetPrefixState(): void {
  if (prefixTimer !== null) clearTimeout(prefixTimer)
  prefixTimer = null
  prefixArmedAt = null
  prefixArmedOnPassthrough = false
  prefixArmedOptions = []
  prefixHudSetArmed(false)
}

function armPrefix(now: number, options: readonly PrefixHudOption[], inputPassthrough: boolean): void {
  resetPrefixState()
  prefixArmedAt = now
  prefixArmedOnPassthrough = inputPassthrough
  prefixArmedOptions = options.slice()
  prefixTimer = setTimeout(resetPrefixState, prefixConfiguration.timeoutMs)
  prefixHudSetArmed(true, options, now)
}

/**
 * Arm the prefix from the mouse (the clickable footer "commands" hint). Same
 * guards as the keyboard arm in {@link dispatchKeyEvent}: disabled prefix or
 * unreachable catalogue (modal barrier) → no-op. Allowed over terminal
 * passthrough because the prefix is Kobe-global. The armed state is real, so
 * the next keypress dispatches as the second stroke.
 */
export function armPrefixNow(snapshot: readonly RegisteredBinding[], now: number = Date.now()): boolean {
  if (prefixConfiguration.key === null) return false
  const reach = scanReachability(snapshot)
  if (!reach.prefixReachable) return false
  armPrefix(now, reach.prefixOptions, reach.inputPassthrough)
  return true
}

/**
 * Mouse-click a prefix option. It must still be armed and resolve to the same
 * live LIFO binding, so stale UI never operates a newly mounted scope.
 */
export function invokeArmedPrefixAction(
  bindingStack: readonly RegisteredBinding[],
  actionId: string,
  stroke: string,
  now: number = Date.now(),
): boolean {
  if (dispatching || prefixArmedAt === null) return false
  const snapshot = bindingStack.slice()
  const armedPrefixKey = prefixConfiguration.key ?? ""
  const validOption = prefixArmedOptions.some((option) => option.action === actionId && option.stroke === stroke)
  const expired = now - prefixArmedAt > prefixConfiguration.timeoutMs
  const crossedBoundary = inputPassthroughReachable(snapshot) !== prefixArmedOnPassthrough

  if (!validOption || expired || crossedBoundary) {
    resetPrefixState()
    return false
  }

  let hit: Binding | null = null
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const reg = snapshot[i]
    if (!reg) continue
    const cfg = reg.config()
    if (cfg.enabled === false) continue
    const candidate = cfg.bindings.find((binding) => binding.prefix === true && binding.key === stroke)
    if (candidate) {
      if (candidate.id === actionId) hit = candidate
      break
    }
    if (cfg.modal) break
  }

  if (!hit?.action) {
    resetPrefixState()
    return false
  }

  resetPrefixState()
  dispatching = true
  try {
    hit.action.run()
    prefixHudPush({ prefixKey: armedPrefixKey, stroke, action: actionId, at: now })
    return true
  } finally {
    dispatching = false
  }
}

/** Once per chord per process, so a stuck violation doesn't spam every keypress. */
const shadowWarned = new Set<string>()

/**
 * The ctrl+w-class bug (split-close vs tab-close): two ENABLED entries on one
 * chord means LIFO silently picks the winner (React effect order puts
 * ancestors on top). The rule is mutual gating, so warn. Runs on the pre-`cmd`
 * snapshot (the handler may re-gate the loser); below a modal entry is
 * unreachable, not shadowed.
 *
 * DEV-ONLY (`isDev()`, KOBE_DEV=1): it reads every lower config, which breaks
 * the read-one-config-on-hit hot-path budget (test/tui/perf-budgets.test.ts).
 */
function warnShadowedMatch(
  snapshot: readonly RegisteredBinding[],
  hitIndex: number,
  candidates: string[],
  prefix: boolean,
): void {
  for (let j = hitIndex - 1; j >= 0; j--) {
    const cfg = snapshot[j]?.config()
    if (!cfg || cfg.enabled === false) continue
    const shadowed = cfg.bindings.find((b) => Boolean(b.prefix) === prefix && candidates.includes(b.key))
    if (shadowed) {
      if (!shadowWarned.has(shadowed.key)) {
        shadowWarned.add(shadowed.key)
        console.error(
          `[rove keymap] "${shadowed.key}" matched two ENABLED bindings — the lower one is shadowed by LIFO order. Gate one of them off (see tui-react/lib/keymap.ts header).`,
        )
      }
      return
    }
    if (cfg.modal) return
  }
}

/** Match one Binding Stack mode, preserving normal LIFO and modal semantics. */
function dispatchMode(
  snapshot: readonly RegisteredBinding[],
  evt: KeyEvent,
  candidates: string[],
  prefix: boolean,
  runCmd: (cmd: () => void) => void,
): Binding | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const reg = snapshot[i]
    if (!reg) continue
    const cfg = reg.config()
    if (cfg.enabled === false) continue
    // Candidate ORDER is a precedence contract: `shift+z` before bare `z`, so
    // registration order within an entry can't decide. ≤3 candidates, O(1).
    let hit: Binding | undefined
    for (const candidate of candidates) {
      hit = cfg.bindings.find((binding) => Boolean(binding.prefix) === prefix && binding.key === candidate)
      if (hit) break
    }
    if (hit) {
      if (hit.yieldToPassthrough && inputPassthroughReachable(snapshot)) continue
      if (!cfg.modal && isDev()) warnShadowedMatch(snapshot, i, candidates, prefix)
      runCmd(() => hit!.cmd(evt, hit!.slot))
      return hit
    }
    if (cfg.modal) return null
  }
  return null
}

/**
 * Fire the first top-down match; true if one fired. On a hit,
 * `preventDefault()` keeps opentui's native widgets (textarea onSubmit) from
 * also getting the key this tick.
 *
 * Scans a SNAPSHOT taken at entry: a `cmd()` can synchronously push/remove
 * entries (`useBindings` in `src/tui-react/lib/keymap.ts`), and iterating the
 * live array would skip or double-visit. Precedence is unchanged.
 */
export function dispatchKeyEvent(
  bindingStack: readonly RegisteredBinding[],
  evt: {
    defaultPrevented: boolean
    preventDefault(): void
    name?: string
    raw?: string
    ctrl?: boolean
    meta?: boolean
    option?: boolean
    shift?: boolean
  },
  now = Date.now(),
  opts?: { flushSync?: (fn: () => void) => void },
): boolean {
  if (evt.defaultPrevented || dispatching) return false
  if (isKittyModifierKeyName(evt.name)) {
    evt.preventDefault()
    return true
  }
  const snapshot = bindingStack.slice()
  const candidates = matchKey(evt as KeyEvent)
  const runCmd = opts?.flushSync ?? ((fn) => fn())
  dispatching = true
  try {
    // An armed sequence can't cross the PTY boundary; one armed inside the
    // terminal stays valid there.
    if (prefixArmedAt !== null && inputPassthroughReachable(snapshot) !== prefixArmedOnPassthrough) {
      resetPrefixState()
    }
    if (prefixArmedAt !== null) {
      const armedPrefixKey = prefixConfiguration.key ?? ""
      const expired = now - prefixArmedAt > prefixConfiguration.timeoutMs
      prefixArmedAt = null
      if (expired) {
        resetPrefixState()
      } else {
        // Escape cancels an armed sequence instead of also closing a dialog.
        if (candidates.includes("escape")) {
          resetPrefixState()
          evt.preventDefault()
          return true
        }
        // A miss is consumed so it can't type into an input or the terminal.
        resetPrefixState()
        const hit = dispatchMode(snapshot, evt as KeyEvent, candidates, true, runCmd)
        prefixHudPush({
          prefixKey: armedPrefixKey,
          stroke: candidates[0] ?? "",
          action: hit ? (hit.id ?? hit.key) : null,
          at: now,
        })
        evt.preventDefault()
        return true
      }
    }

    if (prefixConfiguration.key !== null && candidates.includes(prefixConfiguration.key)) {
      // The first stroke is Kobe-global, even over the terminal. With no
      // reachable prefix row, direct dispatch below lets passthrough win.
      if (prefixReachable(snapshot)) {
        const reach = scanReachability(snapshot)
        armPrefix(now, reach.prefixOptions, reach.inputPassthrough)
        evt.preventDefault()
        return true
      }
    }

    const direct = dispatchMode(snapshot, evt as KeyEvent, candidates, false, runCmd)
    if (direct) {
      // HUD shows only real modifier chords: bare pane letters (j/k) and
      // shift+letter (just uppercase typing) would be noise.
      if (direct.id && direct.key.includes("+") && !direct.key.startsWith("shift+")) {
        prefixHudPush({ prefixKey: "", stroke: direct.key, action: direct.id ?? direct.key, at: now })
      }
      evt.preventDefault()
      return true
    }
    return false
  } finally {
    dispatching = false
  }
}
