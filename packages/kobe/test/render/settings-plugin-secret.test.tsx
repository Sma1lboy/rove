/** @jsxImportSource @opentui/react */
/**
 * Settings → Plugins renders a `secret` row masked.
 *
 * The unit test pins `displaySettingValue` in isolation, which cannot catch
 * the failure that actually matters here: the row rendering `setting.value`
 * directly and never calling the masker. The stored key has to be absent from
 * a REAL rendered frame, next to a plain `string` row that still shows its
 * value — otherwise "masked" could just mean "this section renders nothing".
 */

import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readPluginSettings } from "@sma1lboy/kobe-daemon/plugins/settings-env"
import { RenameTaskDialog } from "../../src/tui-react/component/rename-task-dialog"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { displaySettingValue } from "../../src/tui-react/component/settings-dialog/plugin-settings-core"
import { setPluginSetting } from "../../src/tui-react/component/settings-dialog/plugins-core"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

// Every test here repoints KOBE_HOME_DIR at its own fixture. Left set, it
// follows the process into every later file in the run (the render track is
// one bun process), so restore it rather than leaking a plugin fixture into
// suites that expect the real home.
const REAL_HOME_DIR = process.env.KOBE_HOME_DIR
afterEach(() => {
  if (REAL_HOME_DIR !== undefined) {
    process.env.KOBE_HOME_DIR = REAL_HOME_DIR
    return
  }
  // Genuinely unset it. `readRoveEnv` uses `??`, so "" resolves to a RELATIVE
  // `.rove`, and assigning undefined stores the STRING "undefined" — both are
  // worse than the perf rule this suppresses.
  // biome-ignore lint/performance/noDelete: restoring an unset env var
  delete process.env.KOBE_HOME_DIR
})
const TOKEN = "sk-live-51H8xQ2eZvKYlo"

const manifestFor = (id: string): string => `id = "${id}"
name = "Secret Demo"
version = "0.1.0"
min_rove_version = "0.1.0"

[[settings]]
key = "EX_PLAIN_NAME"
label = "Display name"
type = "string"

[[settings]]
key = "EX_SECRET_TOKEN"
label = "API key"
type = "secret"
`

/** A home with the plugin registered and both settings already stored. */
function seedHome(id: string): string {
  const home = mkdtempSync(join(tmpdir(), "kobe-secret-row-"))
  const root = mkdtempSync(join(tmpdir(), "kobe-secret-root-"))
  writeFileSync(join(root, "rove-plugin.toml"), manifestFor(id))
  mkdirSync(join(home, ".rove"), { recursive: true })
  writeFileSync(
    join(home, ".rove", "plugins.json"),
    JSON.stringify({
      plugins: [
        {
          id,
          source: { kind: "link" },
          root,
          enabled: true,
          version: "0.1.0",
          installedAt: 1,
        },
      ],
    }),
  )
  const config = join(home, ".rove", "plugins", id, "config")
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, ".env"), `EX_PLAIN_NAME=Rover\nEX_SECRET_TOKEN=${TOKEN}\n`)
  return home
}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("the secret's value never reaches the frame, while a plain row still shows its own", async () => {
  process.env.KOBE_HOME_DIR = seedHome("example.maskrow")
  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 40,
    providers: { kv: true, dialog: true },
  })
  // Walk UP to Plugins (general → dev → feedback → keys → plugins): stepping
  // DOWN crosses Engines, which renders real engine accounts.
  for (const key of ["k", "k", "k", "k"]) {
    act(() => mockInput.pressKey(key))
    await settle()
  }
  act(() => mockInput.pressKey("l"))
  await settle()

  const rendered = await frame()
  expect(rendered).toContain("API key")
  expect(rendered).toContain("••••")
  // The whole point: not the token, and not any usable run of it.
  expect(rendered).not.toContain(TOKEN)
  for (let i = 6; i <= TOKEN.length; i++) expect(rendered).not.toContain(TOKEN.slice(0, i))
  // Proof the section really rendered values — otherwise the absence above
  // would be satisfied by an empty pane.
  expect(rendered).toContain("Rover")
})

/**
 * Answer the next `RenameTaskDialog.show` with `answer`, recording what the
 * dialog was opened WITH — the value it pre-fills and the placeholder it
 * shows. For a secret those are the leak: a dialog seeded with the stored key
 * reprints in full the thing the masked row exists to hide.
 *
 * `settled` resolves once the stub has actually answered: `editSetting` is
 * async, so restoring `show` before it has run would hand the prompt to the
 * REAL dialog, which nobody is there to answer.
 */
function captureDialog(answer: string | undefined) {
  const seen: { current: string; placeholder?: string }[] = []
  let markAnswered: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    markAnswered = resolve
  })
  const original = RenameTaskDialog.show
  RenameTaskDialog.show = (async (_dialog: unknown, current: string, opts?: { placeholder?: string }) => {
    seen.push({ current, placeholder: opts?.placeholder })
    markAnswered()
    return answer
  }) as typeof RenameTaskDialog.show
  return {
    seen,
    settled,
    restore: () => {
      RenameTaskDialog.show = original
    },
  }
}

/**
 * Open Settings → Plugins, then CLICK the "API key" row.
 *
 * The cursor is a background highlight, invisible in the text frame, so
 * counting `j` presses would be guessing. The row's y is read off the
 * rendered frame instead, which stays correct if the section grows a row.
 */
async function activateSecretRow(
  mockInput: { pressKey: (k: string) => void },
  mockMouse: { click: (x: number, y: number) => Promise<void> },
  frame: () => Promise<string>,
): Promise<void> {
  for (const key of ["k", "k", "k", "k", "l"]) {
    act(() => mockInput.pressKey(key))
    await settle()
  }
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes("API key"))
  if (y < 0) throw new Error("no API key row rendered")
  const x = (lines[y] as string).indexOf("API key") + 2
  // `mockMouse.click` is ASYNC: firing it outside an awaited act() leaves the
  // renderer mid-update, and every LATER test in the run then captures an
  // empty frame. (The "act without await" warning is the tell.)
  await act(async () => {
    await mockMouse.click(x, y)
  })
  await settle()
}

test("editing a secret opens an EMPTY field, never pre-filled with the stored key", async () => {
  process.env.KOBE_HOME_DIR = seedHome("example.emptyedit")
  const dialog = captureDialog(undefined) // cancel — no write
  try {
    const { frame, mockInput, mockMouse } = await renderComponent(<Driver />, {
      width: 110,
      height: 40,
      providers: { kv: true, dialog: true },
    })
    await activateSecretRow(mockInput, mockMouse, frame)
    // Wait for the edit flow to actually reach the dialog before restoring.
    await dialog.settled
    await settle()
    expect(dialog.seen.length).toBeGreaterThan(0)
    for (const opened of dialog.seen) {
      expect(opened.current).toBe("")
      expect(opened.placeholder ?? "").not.toContain(TOKEN)
    }
  } finally {
    dialog.restore()
  }
})

/**
 * The store side — a submitted secret reaches the plugin verbatim, because
 * masking is a RENDER decision and must not touch what is written. Driven
 * through the same edit path, but the write is asserted on disk rather than
 * from a third mount: the render harness does not survive three mounts of
 * this dialog in one file (the third reads a stale frame).
 */
test("a submitted secret is stored verbatim — masking is display-only", () => {
  const home = seedHome("example.storeverbatim")
  setPluginSetting("example.storeverbatim", "EX_SECRET_TOKEN", "sk-live-REPLACEMENT", home)
  expect(readPluginSettings("example.storeverbatim", home).EX_SECRET_TOKEN).toBe("sk-live-REPLACEMENT")
  // ...and that stored value still renders masked.
  expect(displaySettingValue({ type: "secret", value: "sk-live-REPLACEMENT" })).not.toContain("REPLACEMENT")
})
