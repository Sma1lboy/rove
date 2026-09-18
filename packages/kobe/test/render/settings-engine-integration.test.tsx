/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines, third line: which reporting layers each engine has, and
 * whether the hooks Rove installs are the CURRENT shape.
 *
 * Driven end to end through the real dialog rather than asserted on a fixture:
 * the state that matters here is produced by a WRITE (the install row rewrites
 * the engine's own settings file), and a hand-built fixture proves nothing
 * about a write path. So the test seeds an engine config the way an older Rove
 * left it, reads `hooks outdated` off the frame, presses the install row, and
 * reads `hooks installed` off the next one.
 *
 * Every vendor config home is redirected into a temp dir. Without that the
 * install row would rewrite the operator's real `~/.claude/settings.json`
 * while the suite runs.
 */

import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

/** Point every vendor's config home at a throwaway dir and return it. */
function isolateVendorHomes(tag: string): string {
  const home = mkdtempSync(join(tmpdir(), tag))
  process.env.KOBE_HOME_DIR = home
  process.env.CLAUDE_CONFIG_DIR = join(home, "claude")
  process.env.CODEX_HOME = join(home, "codex")
  process.env.COPILOT_HOME = join(home, "copilot")
  process.env.KIMI_CODE_HOME = join(home, "kimi")
  process.env.PI_CODING_AGENT_DIR = join(home, "pi-agent")
  return home
}

test("an engine config written by an older Rove reads outdated, and the install row fixes it", async () => {
  const home = isolateVendorHomes("kobe-engine-integration-")
  const claudeDir = process.env.CLAUDE_CONFIG_DIR as string
  const settings = join(claudeDir, "settings.json")
  require("node:fs").mkdirSync(claudeDir, { recursive: true })
  // An install from before the version stamp existed: Rove's own command,
  // with no `--hook-version`.
  writeFileSync(
    settings,
    `${JSON.stringify(
      {
        model: "opus",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "rove hook turn-complete --engine claude" }] }] },
      },
      null,
      2,
    )}\n`,
  )

  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 120,
    height: 44,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string): Promise<string> => {
    act(() => mockInput.pressKey(key))
    await settle()
    return await frame()
  }

  await press("j") // sidebar: General → Engines
  await press("l") // into the engine list
  await settle()

  const before = await frame()
  expect(before).toContain("hooks outdated")
  expect(home.length).toBeGreaterThan(0)

  // `k` from the first row wraps to the LAST one — the install row — without
  // this test knowing how many engines this machine detected. Counting `j`
  // presses would be a hard-coded index that a newly installed contrib CLI
  // silently shifts.
  await press("k")
  // `pressEnter()`, not `pressKey("return")` — the mock types key NAMES, so
  // the latter would send the six letters "return" into the dialog.
  act(() => mockInput.pressEnter())
  for (let i = 0; i < 50 && !readFileSync(settings, "utf8").includes("--hook-version"); i++) {
    await settle()
  }

  // The write landed, and it did not clobber the unrelated key.
  const after = readFileSync(settings, "utf8")
  expect(after).toContain("--hook-version")
  expect((JSON.parse(after) as { model: string }).model).toBe("opus")
  // …and the panel re-read it rather than showing the state it booted with.
  expect(await frame()).toContain("hooks installed")
})

test("an engine with no hook adapter says so instead of reading as broken", async () => {
  isolateVendorHomes("kobe-engine-integration-none-")
  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 120,
    height: 44,
    providers: { kv: true, dialog: true },
  })
  act(() => mockInput.pressKey("j"))
  await settle()
  act(() => mockInput.pressKey("l"))
  await settle()

  const text = await frame()
  // Claude reports every state through hooks, so it declares no screen rules
  // — that is the correct row, not a missing layer.
  expect(text).toContain("no screen rules")
  // And the layer vocabulary is on screen at all.
  expect(text.includes("markers") || text.includes("no markers")).toBe(true)
})
