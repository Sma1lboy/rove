/** @jsxImportSource @opentui/react */
/**
 * Real-render coverage for the Settings dialog: mount the actual component,
 * walk every section with the real `j` chord, and assert each section's own
 * body content — including the localized Keybindings command-layer block
 * with its live prefix/timeout values.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { type KVContext, useKV } from "../../src/tui-react/context/kv"
import { devRows, rowIndex } from "../../src/tui/component/settings-dialog/model"
import { PREFIX_TAP_PRESENTATION_KEY } from "../../src/tui/lib/prefix-tap-presentation"
import { act, renderComponent, waitForFrameText } from "./harness"

const NOOP = (): void => {}

let kv: KVContext | undefined

/** One key per act + render pass: keys that land in the same pass act on a stale cursor. */
async function pressTimes(
  h: { mockInput: { pressKey(k: string): void }; frame(): Promise<string> },
  key: string,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    act(() => h.mockInput.pressKey(key))
    await h.frame()
  }
}

function Driver() {
  kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

describe("SettingsDialog", () => {
  // Marketplace queries GitHub the moment it is opened, and every test here
  // that walks past that section would otherwise make a real request.
  const realFetch = globalThis.fetch
  const savedHome = process.env.ROVE_HOME_DIR
  beforeAll(() => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ items: [{ full_name: "you/rove-demo", description: "a demo", stargazers_count: 7 }] }),
    })) as unknown as typeof fetch
  })
  afterAll(() => {
    globalThis.fetch = realFetch
    if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
    else process.env.ROVE_HOME_DIR = savedHome
  })

  it("walks every section with the real j chord and renders each body", async () => {
    process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-settings-"))
    const { frame, mockInput } = await renderComponent(<Driver />, {
      width: 110,
      // Tall enough for a whole section inside the page's scroll viewport.
      height: 90,
      providers: { kv: true, dialog: true },
    })

    // General opens first: theme list + the keyboard-hints toggle.
    let text = await frame()
    expect(text).toContain("Theme")
    expect(text).toContain("Show keyboard hints")

    const press = async (key: string): Promise<string> => {
      act(() => mockInput.pressKey(key))
      return await frame()
    }

    // Engines now carries what was the Accounts section: each engine's row is
    // followed by what detection found for it.
    text = await press("j") // → Engines
    expect(text).toContain("Engines Rove can start on this machine")
    expect(text).toMatch(/Claude\s+● .*available/) // one line per engine: name, status, the on/off mark
    expect(text).toContain("Engine integrations")
    text = await press("j") // → Auto routing
    expect(text).toContain("Routing by depth: a task says how deep the work is")
    // The rows, not the verdict: whether claude is logged in is a fact about
    // the machine running the suite (CI is not), so the gate line is pinned
    // by settings-auto-routing-section.test.tsx with a stubbed verdict.
    expect(text).toContain("swift      Claude · sonnet · engine default")
    text = await press("j") // → Plugins
    expect(text).toContain("Kanban and Issues are first-party mods")
    await press("j") // → Marketplace
    text = await waitForFrameText(frame, "you/rove-demo")
    expect(text).toContain("★7")
    text = await press("j") // → Keybindings
    expect(text).toContain("Command layer (ctrl+a)")
    expect(text).toContain("5000ms second-stroke window")
    expect(text).toContain("On-screen entries + complete guide (default)")
    expect(text).toContain("Complete guide only")
    expect(text).toContain("Prefix key")
    text = await press("j") // → Feedback
    expect(text).toContain("GitHub issue")
    text = await press("j") // → Dev
    expect(text).toContain("Reset UI state")
  })

  it("selects and persists the prefix-tap presentation with ordinary Settings keys", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-prefix-setting-"))
    process.env.ROVE_HOME_DIR = home
    const h = await renderComponent(<Driver />, {
      width: 110,
      // Tall enough for a whole section inside the page's scroll viewport.
      height: 90,
      providers: { kv: true, dialog: true },
    })
    const { frame, mockInput } = h

    // General → Engines → Auto routing → Plugins → Marketplace → Keybindings.
    await pressTimes(h, "j", 5)
    expect(await frame()).toContain("(●) On-screen entries + complete guide (default)")

    await pressTimes(h, "l", 1)
    await pressTimes(h, "j", 1)
    act(() => mockInput.pressEnter())
    act(() => kv?.flush())

    expect(await frame()).toContain("(●) Complete guide only")
    const persisted = JSON.parse(readFileSync(join(home, ".config", "rove", "state.json"), "utf8")) as Record<
      string,
      unknown
    >
    expect(persisted[PREFIX_TAP_PRESENTATION_KEY]).toBe("guide")
  })

  it("Dev → Reload settings applies a hand edit to state.json in place", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-reload-setting-"))
    process.env.ROVE_HOME_DIR = home
    const h = await renderComponent(<Driver />, {
      width: 110,
      height: 90,
      providers: { kv: true, dialog: true },
    })
    const { frame, mockInput } = h
    await pressTimes(h, "k", 1) // General wraps up to Dev
    expect(await frame()).toContain("[ ] Remote projects")

    mkdirSync(join(home, ".config", "rove"), { recursive: true })
    writeFileSync(join(home, ".config", "rove", "state.json"), JSON.stringify({ "experimental.remoteProjects": true }))
    await pressTimes(h, "l", 1)
    // No orchestrator prop, so no daemon-restart row.
    await pressTimes(h, "j", rowIndex(devRows(false), "dev-reload"))
    act(() => mockInput.pressEnter())
    const text = await frame()
    expect(text).toContain("Reloaded: 1 changed.")
    expect(text).toContain("[x] Remote projects")
  })
})
