/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto effort (`settings-dialog/sections-auto-effort.tsx`): the
 * gate's verdict is rendered under each tier, so a tier pointed at an engine
 * that is not logged in reads "unavailable" HERE — not at launch. The section
 * takes the hook's result as a prop, so the verdicts are pinned directly.
 *
 * The classifier half is pinned on ONE thing above all: the sentence saying
 * the prompt goes to someone who is not the user's engine vendor is on
 * screen in every mode, including off. That is hard requirement 4 of
 * `docs/design/auto-effort-classifier.md`, and it is the kind of line that
 * quietly becomes conditional during a later layout tidy.
 */

import { describe, expect, test } from "bun:test"
import { DEFAULT_AUTO_EFFORT } from "../../src/engine/auto-effort"
import { AutoEffortSettingsSection } from "../../src/tui-react/component/settings-dialog/sections-auto-effort"
import type { AutoEffortSettings } from "../../src/tui-react/component/settings-dialog/use-auto-effort-settings"
import type { ClassifierSettings } from "../../src/tui-react/component/settings-dialog/use-classifier-settings"
import { renderComponent } from "./harness"

const OFF: ClassifierSettings = {
  mode: "off",
  endpoint: "",
  threshold: 0.5,
  keyEnv: "TYPESAFE_API_KEY",
  keyPresent: false,
  cycle: () => {},
  editEndpoint: async () => {},
  editThreshold: async () => {},
}

function mount(autoEffort: AutoEffortSettings, classifier: ClassifierSettings = OFF) {
  return renderComponent(
    <AutoEffortSettingsSection
      level="body"
      bodyRow={0}
      setLevel={() => {}}
      setBodyRow={() => {}}
      rowRef={() => () => undefined}
      autoEffort={autoEffort}
      classifier={classifier}
    />,
    { width: 120, height: 60, providers: { dialog: true } },
  )
}

const ready: AutoEffortSettings = { table: DEFAULT_AUTO_EFFORT, block: () => null, edit: async () => {} }

/** The frame as one line. A sentence that word-wraps at column 120 is still
 *  the same sentence to the reader, and an assertion that breaks when the
 *  wrap point moves is testing the terminal width, not the copy. */
const flat = (frame: string) => frame.replace(/\s+/g, " ")

describe("AutoEffortSettingsSection", () => {
  test("a tier whose engine is not logged in says so; the others read ready", async () => {
    const { frame } = await mount({
      table: { ...DEFAULT_AUTO_EFFORT, deep: { engine: "kimi", model: "k2" } },
      block: (tier) => (tier === "deep" ? { kind: "account", engine: "kimi" } : null),
      edit: async () => {},
    })
    const text = await frame()
    expect(text).toContain("unavailable — engine kimi is not logged in")
    expect((text.match(/● ready/g) ?? []).length).toBe(2)
    // The rows show what each tier RUNS; the prose says what it is FOR.
    expect(text).toContain("Claude · sonnet · engine default")
    expect(text).toContain("Kimi · k2 · engine default")
  })

  test("a blanked tier renders the unconfigured warning instead of a table", async () => {
    const { frame } = await mount({ table: null, block: () => undefined, edit: async () => {} })
    expect(await frame()).toContain("Auto effort is off")
  })
})

describe("AutoEffortSettingsSection — the classifier", () => {
  test("says where the prompt goes even while the classifier is off", async () => {
    const { frame } = await mount(ready)
    const text = flat(await frame())
    // The disclosure is not gated on the switch: someone deciding whether to
    // turn this on reads it BEFORE, which is the only time it can change
    // their mind.
    expect(text).toContain("sends the task's first message to a third party that is NOT the engine vendor you picked")
    expect(text).toContain("Nothing leaves this machine while it is off")
    expect(text).toContain("Classifier off")
  })

  test("off shows no key line — there is no key to need", async () => {
    const text = flat(await (await mount(ready)).frame())
    expect(text).not.toContain("TYPESAFE_API_KEY is not set")
  })

  test("on without the env var says so, because that looks exactly like working", async () => {
    const text = flat(await (await mount(ready, { ...OFF, mode: "jev" })).frame())
    expect(text).toContain("TYPESAFE_API_KEY is not set")
    expect(text).toContain("tasks keep their usual depth")
  })

  test("on with the env var set reports where the key came from", async () => {
    const text = flat(await (await mount(ready, { ...OFF, mode: "jev", keyPresent: true })).frame())
    expect(text).toContain("key read from TYPESAFE_API_KEY")
  })

  test("custom mode shows its endpoint and the floor, both editable", async () => {
    const text = await (
      await mount(ready, {
        ...OFF,
        mode: "custom",
        endpoint: "https://tiers.internal/pick",
        threshold: 0.7,
        keyPresent: true,
      })
    ).frame()
    expect(flat(text)).toContain("https://tiers.internal/pick")
    expect(flat(text)).toContain("Confidence floor 0.70")
  })

  test("custom with nothing typed yet says how to get there, not a blank", async () => {
    const text = flat(await (await mount(ready)).frame())
    expect(text).toContain("enter one to switch to custom")
  })
})
