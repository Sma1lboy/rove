/** @jsxImportSource @opentui/react */
/**
 * Settings → Marketplace, mounted for real: the listing joins against the
 * registry so an installed plugin is marked instead of offered again, and
 * enter on a row hands the ref to the installer and reports what came back.
 *
 * Nothing here is allowed to clone: both rows the test activates fail before
 * any network or filesystem work (one is already installed, the other is not
 * valid GitHub shorthand), which is exactly what makes the chord's wiring
 * observable without a real install.
 */

import { afterAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { savePluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, waitForFrameText } from "./harness"

const NOOP = (): void => {}

const savedHome = process.env.ROVE_HOME_DIR
afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

async function repeat(n: number, step: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < n; i++) await step()
}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("Marketplace marks installed plugins and reports an install it refused", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-marketplace-"))
  process.env.ROVE_HOME_DIR = home
  savePluginRegistry(
    {
      plugins: [
        {
          id: "acme.thing",
          source: { kind: "github", spec: "you/rove-thing" },
          root: join(home, ".rove", "plugins", "acme.thing"),
          enabled: true,
          version: "1.0.0",
          installedAt: 0,
        },
      ],
    },
    home,
  )

  const realFetch = globalThis.fetch
  // Topic results land AFTER the first-party seeds, so the two rows under
  // test are the last two — reachable by wrapping upward from row 0, with no
  // dependence on how many seeds the fallback list happens to carry.
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      items: [
        { full_name: "you/rove-thing", description: "already here", stargazers_count: 12 },
        { full_name: "bogus", description: "not github shorthand", stargazers_count: 1 },
      ],
    }),
  })) as unknown as typeof fetch

  try {
    const { frame, mockInput } = await renderComponent(<Driver />, {
      width: 110,
      height: 90,
      providers: { kv: true, dialog: true },
    })
    const press = async (key: string): Promise<string> => {
      act(() => mockInput.pressKey(key))
      return await frame()
    }
    const enter = async (outcome: string): Promise<string> => {
      act(() => mockInput.pressEnter())
      return await waitForFrameText(frame, outcome)
    }

    // General → Engines → Auto routing → Plugins → Marketplace
    await repeat(4, () => press("j"))
    const listing = await waitForFrameText(frame, "you/rove-thing")
    // Joined against the registry: the tag replaces the star count.
    expect(listing).toContain("installed")
    expect(listing).not.toContain("★12")

    await press("l") // into the body, row 0
    await press("k") // wrap to the last row — the invalid ref
    const refused = await enter("install failed")
    expect(refused).toContain("GitHub shorthand")

    await press("k") // → you/rove-thing, the installed one
    await enter("already installed as acme.thing")
  } finally {
    globalThis.fetch = realFetch
  }
})
