/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto routing (`settings-dialog/sections-auto-routing.tsx`): the
 * gate's verdict is rendered under each tier, so a tier pointed at an engine
 * that is not logged in reads "unavailable" HERE — not at launch. The section
 * takes the hook's result as a prop, so the verdicts are pinned directly.
 *
 * The classifier rows underneath are pinned on the same terms, and the case
 * that matters most is the data-flow sentence: `docs/design/auto-routing-
 * classifier.md` makes "the prompt goes to someone who is not your engine
 * vendor" a thing the SWITCH has to say, in every mode including off. A
 * refactor that folded it into the section hint, or showed it only once the
 * classifier was on, would look tidier and would break the decision.
 */

import { describe, expect, test } from "bun:test"
import { DEFAULT_AUTO_ROUTING } from "../../src/engine/auto-routing"
import { AutoRoutingSettingsSection } from "../../src/tui-react/component/settings-dialog/sections-auto-routing"
import type { AutoRoutingSettings } from "../../src/tui-react/component/settings-dialog/use-auto-routing-settings"
import type { ClassifierSettings } from "../../src/tui-react/component/settings-dialog/use-classifier-settings"
import { renderComponent } from "./harness"

const OFF: ClassifierSettings = {
  mode: "off",
  endpoint: "",
  threshold: 0.5,
  keyEnv: "TYPESAFE_API_KEY",
  keySource: "none",
  keyConfigured: true,
  keyHint: "",
  cycle: () => {},
  editEndpoint: async () => {},
  editThreshold: async () => {},
  editKey: async () => {},
}

const READY: AutoRoutingSettings = {
  table: DEFAULT_AUTO_ROUTING,
  block: () => null,
  edit: async () => {},
}

function mount(autoRouting: AutoRoutingSettings, classifier: ClassifierSettings = OFF) {
  return renderComponent(
    <AutoRoutingSettingsSection
      level="body"
      bodyRow={0}
      setLevel={() => {}}
      setBodyRow={() => {}}
      rowRef={() => () => undefined}
      autoRouting={autoRouting}
      classifier={classifier}
    />,
    { width: 120, height: 60, providers: { dialog: true } },
  )
}

describe("AutoRoutingSettingsSection", () => {
  test("a tier whose engine is not logged in says so; the others read ready", async () => {
    const { frame } = await mount({
      table: { ...DEFAULT_AUTO_ROUTING, deep: { engine: "kimi", model: "k2" } },
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
    expect(await frame()).toContain("Auto routing is off")
  })

  test("says where the prompt goes even while the classifier is OFF", async () => {
    // Hard requirement 4. Off is the default, so this is the state most users
    // ever see — if the sentence only appeared once someone switched the
    // classifier on, the decision to switch it on would be the one made
    // without it.
    const { frame } = await mount(READY, OFF)
    const text = await frame()
    expect(text).toContain("third party that is NOT the engine vendor you picked")
    expect(text).toContain("Nothing leaves this machine while it is off")
    expect(text).toContain("Choose with")
  })

  test("offers custom as well as jev — a self-hosted endpoint is the local-only escape hatch", async () => {
    const { frame } = await mount(READY, {
      ...OFF,
      mode: "custom",
      endpoint: "http://127.0.0.1:8000/tier",
      keyConfigured: false,
    })
    const text = await frame()
    expect(text).toContain("custom")
    expect(text).toContain("http://127.0.0.1:8000/tier")
    // A custom endpoint gets no Authorization header until its own variable
    // is named, so "no key" there is normal operation, not a warning.
    expect(text).toContain("no Authorization header is sent to a custom endpoint")
    expect(text).not.toContain("no key — nothing is chosen")
  })

  test("warns that jev without a key does nothing, and stops warning once one is stored", async () => {
    // The commonest way for a switched-on classifier to look broken.
    const missing = await mount(READY, { ...OFF, mode: "jev" })
    expect(await missing.frame()).toContain("no key — nothing is chosen")

    const stored = await mount(READY, { ...OFF, mode: "jev", keySource: "file", keyHint: "…wxyz" })
    const text = await stored.frame()
    expect(text).toContain("key stored in ~/.rove/secrets.json")
    // The row shows a tail, never the key.
    expect(text).toContain("stored …wxyz")
  })

  test("names the variable when the environment is what will actually be sent", async () => {
    // The environment outranks a stored key, so someone who pastes one here
    // while a shell export is live needs something to blame.
    const { frame } = await mount(READY, { ...OFF, mode: "jev", keySource: "env", keyHint: "…wxyz" })
    expect(await frame()).toContain("$TYPESAFE_API_KEY")
  })
})
