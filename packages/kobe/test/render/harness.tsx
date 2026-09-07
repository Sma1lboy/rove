/** @jsxImportSource @opentui/react */
/**
 * Render-track test harness — mount a REAL opentui React component and
 * assert on its actual rendered frame / keyboard interaction.
 *
 * Why `bun test`, not vitest: opentui components (`src/**\/*.tsx`) can't run
 * under vitest's node environment — `@opentui/core` ships raw `.scm`/`.wasm`
 * assets via `with { type: "file" }` imports node's loader can't resolve, and
 * `bun build --compile`'s reconciler needs the bun runtime. `@opentui/react`'s
 * `testRender` mounts a component against a real headless renderer under bun;
 * this whole directory is invisible to vitest (see vitest.config.ts's
 * `test/render/**` exclusion) and runs via `bun test` (`test:render`).
 *
 * Usage:
 *
 *   import { renderComponent } from "./harness"
 *
 *   test("shows the confirm title", async () => {
 *     const { frame, mockInput } = await renderComponent(
 *       <MyDialog title="Delete task?" />,
 *       { providers: { dialog: true } },
 *     )
 *     expect(await frame()).toContain("Delete task?")
 *     mockInput.pressEnter()
 *     expect(await frame()).toContain("...")
 *   })
 */

import { afterEach } from "bun:test"
import { EventEmitter } from "node:events"
import type { CapturedFrame } from "@opentui/core"
import type { MockInput, MockMouse, TestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { type ReactNode, act } from "react"
import { FocusProvider } from "../../src/tui-react/context/focus"
import { KVProvider } from "../../src/tui-react/context/kv"
import { NotificationsProvider } from "../../src/tui-react/context/notifications"
import { ThemeProvider } from "../../src/tui-react/context/theme"
import { DialogProvider } from "../../src/tui-react/ui/dialog"
import { setPrefixHudClock } from "../../src/tui/lib/prefix-hud"

export { act }

/** Which ambient providers to mount around the component under test. All default off except `theme`. */
export interface ProviderFlags {
  /** `<ThemeProvider theme="claude">`. Default true — nearly every component reads `useTheme()`. */
  theme?: boolean
  /** `<KVProvider>` — persisted UI state. Reads/writes `$KOBE_HOME_DIR/.config/rove/state.json`; set that env var in a test that enables this. Default false. */
  kv?: boolean
  /** `<FocusProvider>` — pane focus context. Default false. */
  focus?: boolean
  /** `<DialogProvider>` — the dialog stack (`useDialog()`). Required by every `*Dialog` component. Default false. */
  dialog?: boolean
  /** `<NotificationsProvider>` — toast queue (`useNotifications()`). Default false. */
  notifications?: boolean
}

export interface RenderOptions {
  width?: number
  height?: number
  providers?: ProviderFlags
}

export interface RenderHandle {
  renderer: TestRenderer
  mockInput: MockInput
  mockMouse: MockMouse
  /** Flush pending render passes and return the captured char-grid frame as a string. */
  frame: () => Promise<string>
  /** Flush pending render passes without capturing — use between `mockInput` actions when only the final frame matters. */
  rerender: () => Promise<void>
  /** Flush pending render passes and return the captured frame with per-span colors/attributes — for assertions that need actual fg/bg. */
  spans: () => Promise<CapturedFrame>
  resize: (width: number, height: number) => void
  destroy: () => void
}

// Tracks the most recently created renderer so `afterEach` can destroy it even
// if a test forgets to (or fails before its own destroy).
//
// Destroying it does NOT reliably drain the module-global `useBindings` stack.
// Measured on the full suite: 30 `renderComponent` calls across 9 files start
// with a `modalOwner` barrier still registered from an earlier test, and in 7
// of them the barrier is still there on the line after `destroy()` returned —
// no throw, the effect cleanup just never ran. `liveRenderer` also only ever
// holds the LAST renderer, so a test that calls `renderComponent` twice
// abandons the first one entirely: never destroyed, tree still live, pending
// timers in it still firing after the test ended.
//
// So: assume stale key registrations carry into the next test. The one thing
// that clears them is `ensureInstalled` in src/tui-react/lib/keymap.ts, which
// wipes the stack when the next test's first `useBindings` render installs a
// new renderer — and which stops an abandoned tree from registering back into
// the live stack afterwards (test/render/keymap-superseded-modal-leak).
let liveRenderer: TestRenderer | null = null

// opentui/core's process-wide TerminalConsoleCache singleton picks up one
// listener per `testRender()`; a file with >10 tests trips Node's default
// max-listener warning even though every renderer is destroyed. Cosmetic —
// bump the ceiling rather than chase a leak that isn't one.
EventEmitter.defaultMaxListeners = 200

afterEach(() => {
  // A manual clock is process-global; leaving one installed freezes every
  // later file's HUD timers.
  setPrefixHudClock(null)
  if (!liveRenderer) return
  try {
    liveRenderer.destroy()
  } catch {
    // already destroyed by the test itself — fine
  }
  liveRenderer = null
})

/**
 * Install an advanceable clock for the prefix-HUD overlay and return its
 * handle. `advance(ms)` jumps the overlay's `now` forward and fires everything
 * it scheduled inside that window, so a delayed reveal resolves at once
 * instead of riding a real timer on an event loop this suite saturates. Wrap
 * `advance` in `act()` so React flushes the resulting re-render. `afterEach`
 * restores real time.
 *
 * The clock is real time PLUS an offset, not a frozen instant: the dispatch
 * layer stamps `armedAt` with its own `Date.now()` at the moment of the key
 * press, so a clock pinned at install time would sit BEHIND that stamp by
 * however long the mount took, and `advance(PREFIX_GUIDE_DELAY_MS)` would land
 * short. Riding real time keeps the offset exact however long the mount takes.
 */
export function installAdvanceablePrefixHudClock(): { advance(ms: number): void } {
  let offset = 0
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const now = (): number => Date.now() + offset
  setPrefixHudClock({
    now,
    schedule: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: now() + ms, fn })
      return () => pending.delete(id)
    },
  })
  return {
    advance(ms: number) {
      offset += ms
      // Re-read each pass: a fired callback may schedule the next timer.
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= now()).sort((a, b) => a[1].at - b[1].at)
        if (due.length === 0) return
        for (const [id, timer] of due) {
          pending.delete(id)
          timer.fn()
        }
      }
    },
  }
}

/** Wrap `ui` in the requested providers, innermost-to-outermost: Theme > KV > Focus > Dialog > Notifications — the same nesting the real pane hosts mount. */
function withProviders(ui: ReactNode, flags: ProviderFlags | undefined): ReactNode {
  const { theme = true, kv = false, focus = false, dialog = false, notifications = false } = flags ?? {}
  let node = ui
  if (notifications) node = <NotificationsProvider>{node}</NotificationsProvider>
  if (dialog) node = <DialogProvider>{node}</DialogProvider>
  if (focus) node = <FocusProvider>{node}</FocusProvider>
  if (kv) node = <KVProvider>{node}</KVProvider>
  if (theme) node = <ThemeProvider theme="claude">{node}</ThemeProvider>
  return node
}

/**
 * Wait out opentui's raw-mode escape-sequence disambiguation window. A lone
 * ESC byte is ambiguous with the start of a multi-byte escape sequence (arrow
 * keys, `alt+`, kitty chords all start with `\x1B`), so the parser holds it
 * briefly before deciding it was a standalone Escape. `mockInput.pressEscape()`
 * writes the byte synchronously but the resulting `keypress` event doesn't fire
 * until that window closes — call `await settle()` before the next assertion.
 */
export function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `frame()` until the captured frame contains `text` and return that
 * frame. Throws with the last frame on timeout.
 *
 * `timeoutMs` has a HARD ceiling of 5000ms, and growing past it does not buy
 * patience — it buys silence. Two things sit exactly on 5000ms:
 *
 *   1. bun's default per-test timeout (no `[test] timeout` in bunfig.toml).
 *      A budget at or above it means bun kills the test before this function
 *      can throw, so the failure reads `this test timed out after 5000ms`
 *      with no frame dump — the whole point of this error message is lost.
 *   2. `DEFAULT_PREFIX_CONFIGURATION.timeoutMs` — the armed PureTUI prefix
 *      cancels ITSELF 5000ms after the tap and tears the HUD guide down. Past
 *      that point the answer no longer exists to be polled for.
 *
 * So do NOT anchor a budget to a product delay "plus room for a loaded CI
 * runner": that reasoning is what once put this file's guide budget at
 * PREFIX_GUIDE_DELAY_MS + 5000 = 5180ms, over both ceilings, where every
 * failure printed a bare bun timeout and this message never fired once.
 * When a wait depends on a product timer, drive that timer instead of racing
 * it (see `installManualPrefixHudClock`) and keep the budget well under 5000ms.
 */
export async function waitForFrameText(
  frame: () => Promise<string>,
  text: string,
  { timeoutMs = 5_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let current = await frame()
  while (!current.includes(text)) {
    if (Date.now() >= deadline) {
      throw new Error(`frame did not contain ${JSON.stringify(text)} within ${timeoutMs}ms:\n${current}`)
    }
    await settle(intervalMs)
    current = await frame()
  }
  return current
}

/**
 * Mount `ui` against a real opentui React test renderer and return a handle to
 * drive/inspect it. Renders one initial frame before resolving, so `frame()`
 * immediately after `renderComponent()` reflects the mounted state.
 */
export async function renderComponent(ui: ReactNode, options: RenderOptions = {}): Promise<RenderHandle> {
  const { width = 80, height = 24, providers } = options
  const wrapped = withProviders(ui, providers)
  const { renderer, mockInput, mockMouse, flush, captureCharFrame, captureSpans, resize } = await testRender(wrapped, {
    width,
    height,
  })
  liveRenderer = renderer
  await flush()

  return {
    renderer,
    mockInput,
    mockMouse,
    frame: async () => {
      await flush()
      return captureCharFrame()
    },
    rerender: async () => {
      await flush()
    },
    spans: async () => {
      await flush()
      return captureSpans()
    },
    resize,
    destroy: () => {
      renderer.destroy()
      if (liveRenderer === renderer) liveRenderer = null
    },
  }
}
