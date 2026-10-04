/** @jsxImportSource @opentui/react */
/**
 * The on-screen half of a failed `state.json` write.
 *
 * `kv.set` returns after updating the snapshot and scheduling a flush nobody
 * awaits, so a rejected write left only a `console.error` the alternate screen
 * swallows: a theme change or a toggle looked saved for the session and
 * reverted at the next launch. This drives the REAL provider stack — the same
 * KV-above-notifications nesting `lib/host-boot.tsx` builds — because the
 * point of the wiring is that the KV provider sits ABOVE the toast context and
 * structurally cannot raise one; the sink has to be a subscriber below it.
 */

import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useKV } from "../../src/tui-react/context/kv"
import { KvWriteErrorToasts } from "../../src/tui-react/context/kv-write-error-toasts"
import { useNotifications } from "../../src/tui-react/context/notifications"
import { act, renderComponent } from "./harness"

let home: string
let savedHome: string | undefined

beforeAll(() => {
  savedHome = process.env.KOBE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "kobe-kv-toast-"))
  process.env.KOBE_HOME_DIR = home
  // Break the write deterministically: a DIRECTORY where the lockfile goes
  // makes `acquireSync`'s link fail EEXIST, and reading the holder then fails
  // EISDIR — not a contention error, so it propagates immediately.
  mkdirSync(join(home, ".config", "rove", "state.json.lock"), { recursive: true })
})

afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = savedHome
  rmSync(home, { recursive: true, force: true })
})

let failWrite: () => void = () => {}

function Probe() {
  const kv = useKV()
  const { toasts } = useNotifications()
  failWrite = () => {
    kv.set("activeTheme", "tokyonight")
    kv.flush()
  }
  const toast = toasts[0]
  return <text>{toast ? `${toast.kind}|${toast.title}|${toast.body ?? ""}` : "no-toast"}</text>
}

test("a flush that cannot reach state.json surfaces as an error toast naming the file", async () => {
  const { frame } = await renderComponent(
    <>
      <KvWriteErrorToasts />
      <Probe />
    </>,
    { width: 100, height: 6, providers: { kv: true, notifications: true } },
  )
  expect(await frame()).toContain("no-toast")

  await act(async () => {
    failWrite()
  })

  const text = await frame()
  expect(text).toContain("error|Settings were not saved")
  // The path leads the body: a toast is one truncated line, and the home
  // prefix is the part of it that carries no information.
  expect(text).toContain("state.json")
  expect(text).toContain("activeTheme")
})
