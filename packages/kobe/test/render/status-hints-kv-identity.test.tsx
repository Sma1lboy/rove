/** @jsxImportSource @opentui/react */
/**
 * The status hint effect must not re-run because unrelated state was
 * persisted.
 *
 * React #185 on BOOT, with a dependency array already in place: listing `kv`
 * among those dependencies is enough to defeat it. `KVProvider` rebuilds its
 * context value from a `useMemo` keyed on the kv snapshot, so every `kv.set`
 * anywhere in the app — tab adoption recording a task's tab list, a pane
 * marking its hint used — hands the hook a NEW `kv` object and re-runs the
 * effect, which is the same "runs on every render" the array exists to stop.
 * setSnapshot re-renders the footer, the sidebar rows under it remount,
 * `useBindings` bumps the stack version, the rows write kv again, and the
 * workspace crashes 50 nested updates later.
 *
 * `status-hints-no-loop.test.tsx` mounts WITHOUT a KV provider, so `kv` is
 * null there and stays referentially stable — which is why it stayed green
 * through the crash. This file mounts the real provider and writes to it.
 */

import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useStatusKeyHintItems } from "../../src/tui-react/component/keyboard-hints"
import { useKV } from "../../src/tui-react/context/kv"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { act, renderComponent } from "./harness"

// KVProvider persists to `$KOBE_HOME_DIR` — the real ~/.rove without this.
// Per-FILE (beforeAll), matching host-version-skew-banner.test.tsx: bun runs
// every file in one process, and a beforeEach snapshot would restore whatever
// the previous file left behind.
let previousHome: string | undefined

beforeAll(() => {
  previousHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-hint-kv-"))
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
})

let footerRenders = 0

/** A sidebar row: registers bindings, so mounting/unmounting bumps the stack. */
function Row(props: { n: number }) {
  useBindings(() => ({ enabled: true, bindings: [{ key: "x", id: `row.${props.n}`, cmd: () => {} }] }))
  return <text>{`row ${props.n}`}</text>
}

/** The real nesting: the hints hook lives in a PARENT that wraps the rows. */
function Footer(props: { children: React.ReactNode }) {
  footerRenders++
  const items = useStatusKeyHintItems()
  return (
    <box flexDirection="column">
      {props.children}
      <text>{`hints:${items.length}`}</text>
    </box>
  )
}

function App() {
  const kv = useKV()
  // `w` persists something the hint bar does not read — a stand-in for tab
  // adoption or any other background write.
  useBindings(() => ({
    enabled: true,
    bindings: [{ key: "w", id: "probe.write", cmd: () => kv.set("probe.counter", Date.now()) }],
  }))
  return (
    <Footer>
      <Row n={1} />
      <Row n={2} />
      <Row n={3} />
    </Footer>
  )
}

test("an unrelated kv write does not re-run the hint snapshot", async () => {
  const { frame, mockInput } = await renderComponent(<App />, {
    width: 80,
    height: 10,
    providers: { kv: true, focus: true, dialog: true },
  })
  await act(async () => {})

  footerRenders = 0
  for (let i = 0; i < 10; i++) {
    mockInput.typeText("w")
    await act(async () => {})
  }

  // Each write re-renders the footer once (the kv context value is new, and
  // this hook subscribes to it). What must NOT happen is the effect firing
  // and re-setting state on top of that — that second render per write is
  // the feedback edge that closed the loop.
  expect(footerRenders).toBeLessThanOrEqual(12)
  expect(await frame()).toContain("hints:")
})
