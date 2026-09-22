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
  keySource: "none",
  keyHint: "",
  keyConfigured: true,
  cycle: () => {},
  editEndpoint: async () => {},
  editThreshold: async () => {},
  editKey: async () => {},
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
    expect(text).toContain("Route with off")
  })

  test("off shows no key line — there is no key to need", async () => {
    const text = flat(await (await mount(ready)).frame())
    expect(text).not.toContain("TYPESAFE_API_KEY is not set")
  })

  test("on with no key anywhere says so, because that looks exactly like working", async () => {
    const text = flat(await (await mount(ready, { ...OFF, mode: "jev" })).frame())
    expect(text).toContain("no key — nothing is routed")
    expect(text).toContain("tasks keep their usual depth")
    expect(text).toContain("API key not set — enter to paste one")
  })

  test("a stored key shows a tail you can recognise, never the key", async () => {
    const text = flat(
      await (
        await mount(ready, { ...OFF, mode: "jev", keyPresent: true, keySource: "file", keyHint: "…4938" })
      ).frame(),
    )
    expect(text).toContain("stored …4938")
    expect(text).toContain("~/.rove/secrets.json")
    // The row is a place to replace or clear it, not to read it back.
    expect(text).not.toContain("apikey_")
  })

  test("an env var outranks a stored key, and the row names the variable", async () => {
    // Someone who pastes a key here while a shell export is live would
    // otherwise watch it do nothing and have nothing to blame.
    const text = flat(await (await mount(ready, { ...OFF, mode: "jev", keyPresent: true, keySource: "env" })).frame())
    expect(text).toContain("the environment wins over a stored key")
    expect(text).toContain("key read from $TYPESAFE_API_KEY")
  })

  test("custom mode does NOT borrow jev's key semantics", async () => {
    // A custom endpoint gets no Authorization header until a variable names
    // its key, so "no key" there is normal operation — warning about it would
    // report a working setup as silent.
    const text = flat(
      await (
        await mount(ready, { ...OFF, mode: "custom", endpoint: "https://t.internal/p", keyConfigured: false })
      ).frame(),
    )
    expect(text).not.toContain("no key — nothing is routed")
    expect(text).toContain("no Authorization header is sent to a custom endpoint")
  })

  test("a key stored under the shipped variable is not reported as configured for custom", async () => {
    // The other direction: nothing would carry that key to a custom endpoint,
    // so saying "key stored" would claim auth that is not happening.
    const text = flat(
      await (
        await mount(ready, {
          ...OFF,
          mode: "custom",
          endpoint: "https://t.internal/p",
          keyPresent: true,
          keySource: "file",
          keyHint: "…4938",
          // No variable names a key for this endpoint, so nothing carries one.
          keyConfigured: false,
        })
      ).frame(),
    )
    expect(text).not.toContain("key stored in ~/.rove/secrets.json")
    expect(text).toContain("no Authorization header is sent")
  })

  test("a custom endpoint with a NAMED variable does report the key", async () => {
    const text = flat(
      await (
        await mount(ready, {
          ...OFF,
          mode: "custom",
          endpoint: "https://t.internal/p",
          keyPresent: true,
          keySource: "file",
          keyHint: "…4938",
          keyConfigured: true,
        })
      ).frame(),
    )
    expect(text).toContain("key stored in ~/.rove/secrets.json")
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
    expect(text).toContain("enter one, then set Route with to custom")
  })
})
