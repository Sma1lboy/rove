import { afterEach, describe, expect, test } from "bun:test"
import type { AppearanceManifest } from "@sma1lboy/rove-client/appearance/index.ts"
import { applyAppearanceTokens, engineColorForPack } from "../src/appearance/apply.ts"
import { OuterAppearanceBoundary, SlotErrorBoundary } from "../src/appearance/boundaries.tsx"
import {
  type AppearanceListReply,
  appearanceStore,
  disableAppearanceAfterCrash,
  loadAppearances,
  reportSlotCrash,
  resetAppearanceToDefault,
  selectAppearancePack,
} from "../src/appearance/runtime.ts"
import type { BridgeClient } from "../src/bridge.ts"

function fakeRoot(): {
  styleMap: Map<string, string>
  dataset: Record<string, string>
  el: HTMLElement
} {
  const styleMap = new Map<string, string>()
  const dataset: Record<string, string> = {}
  const el = {
    style: {
      setProperty: (k: string, v: string) => styleMap.set(k, v),
      removeProperty: (k: string) => styleMap.delete(k),
    },
    dataset,
  } as unknown as HTMLElement
  return { styleMap, dataset, el }
}

function fakeClient(replies: Record<string, (args?: Record<string, unknown>) => unknown>): BridgeClient {
  return {
    request: async (op: string, args?: Record<string, unknown>) => {
      const fn = replies[op]
      if (!fn) throw new Error(`unexpected op ${op}`)
      return fn(args)
    },
  } as unknown as BridgeClient
}

afterEach(() => {
  appearanceStore.set({
    loaded: false,
    dir: "",
    activeId: "default",
    activePack: null,
    packs: [],
    loadErrors: [],
    slotComponents: {},
    runtimeErrors: [],
    disabledByCrash: false,
  })
})

describe("appearance tokens & runtime", () => {
  test("applyAppearanceTokens sets CSS variables and layout attributes, and restores base vars on reset", () => {
    const { el, styleMap, dataset } = fakeRoot()
    const base = { "--paper": "#141413", "--accent": "#cc785c" }
    const manifest: AppearanceManifest = {
      version: 1,
      name: "Card Pack",
      colors: {
        tokens: { paper: { dark: "#0f1012", light: "#fafafa" }, accent: "#5ea8ff" },
        engineColors: { claude: "#cc785c", default: "#778899" },
      },
      layout: {
        frame: "cards",
        paneGap: 12,
        shellPadding: 10,
        radius: 14,
        density: "spacious",
        borderStyle: "none",
      },
    }

    applyAppearanceTokens(el, manifest, "dark", base)
    expect(styleMap.get("--paper")).toBe("#0f1012")
    expect(styleMap.get("--accent")).toBe("#5ea8ff")
    expect(styleMap.get("--radius")).toBe("14px")
    expect(styleMap.get("--ap-pane-gap")).toBe("12px")
    expect(styleMap.get("--ap-shell-pad")).toBe("10px")
    expect(styleMap.get("--hairline")).toBe("0px")
    expect(dataset.apFrame).toBe("cards")
    expect(dataset.apDensity).toBe("spacious")
    expect(engineColorForPack(manifest, "claude", "dark")).toBe("#cc785c")
    expect(engineColorForPack(manifest, "other", "dark")).toBe("#778899")

    applyAppearanceTokens(el, null, "dark", base)
    expect(styleMap.get("--paper")).toBe("#141413")
    expect(styleMap.get("--accent")).toBe("#cc785c")
    expect(styleMap.has("--radius")).toBe(false)
    expect(styleMap.has("--ap-pane-gap")).toBe(false)
    expect(dataset.apFrame).toBeUndefined()
  })

  test("loadAppearances falls back to default and surfaces exact error for broken active pack", async () => {
    const reply: AppearanceListReply = {
      dir: "/home/u/.rove/appearances",
      active: "broken-pack",
      packs: [],
      errors: [
        {
          id: "broken-pack",
          dir: "/home/u/.rove/appearances/broken-pack",
          file: "appearance.json",
          kind: "manifest",
          message: 'unknown key "bogus"',
          issues: [{ path: "bogus", message: 'unknown key "bogus"' }],
        },
      ],
    }
    const client = fakeClient({
      "appearance.list": () => reply,
      "appearance.set": (args) => ({ ...reply, active: String(args?.id ?? "default") }),
    })

    await loadAppearances(client)
    const state = appearanceStore.get()
    expect(state.activePack).toBeNull()
    expect(state.runtimeErrors).toHaveLength(1)
    expect(state.runtimeErrors[0]?.packId).toBe("broken-pack")
    expect(state.runtimeErrors[0]?.phase).toBe("manifest")
    expect(state.runtimeErrors[0]?.message).toContain('unknown key "bogus"')

    await resetAppearanceToDefault(client)
    expect(appearanceStore.get().activeId).toBe("default")
    expect(appearanceStore.get().runtimeErrors).toEqual([])
  })

  test("selectAppearancePack records bundle errors without activating broken pack", async () => {
    const client = fakeClient({
      "appearance.set": () =>
        ({
          dir: "/home/u/.rove/appearances",
          active: "bad-tsx",
          packs: [
            {
              id: "bad-tsx",
              manifest: { version: 1, name: "Bad TSX" },
              fingerprint: "abc",
              hasComponents: true,
              bundleUrl: null,
              bundleError: {
                id: "bad-tsx",
                file: "components/Row.tsx",
                slot: "rail.row",
                line: 4,
                message: "Unexpected token",
              },
            },
          ],
          errors: [],
        }) satisfies AppearanceListReply,
    })

    await selectAppearancePack(client, "bad-tsx")
    const state = appearanceStore.get()
    expect(state.activePack).toBeNull()
    expect(state.runtimeErrors[0]).toMatchObject({
      packId: "bad-tsx",
      phase: "bundle",
      slot: "rail.row",
      file: "components/Row.tsx:4",
      message: "Unexpected token",
    })
  })

  test("slot and outer error boundaries isolate crashes and record diagnostics", () => {
    appearanceStore.set({
      ...appearanceStore.get(),
      activeId: "ticket-cards",
      activePack: {
        id: "ticket-cards",
        manifest: { version: 1, name: "Ticket Cards" },
        fingerprint: "123",
        hasComponents: true,
        bundleUrl: null,
      },
    })

    // Per-slot boundary catches render throw and falls back only that slot
    expect(SlotErrorBoundary.getDerivedStateFromError()).toEqual({ crashed: true })
    reportSlotCrash("ticket-cards", "rail.row", "components/Row.tsx", new Error("boom in row"))
    reportSlotCrash("ticket-cards", "rail.row", "components/Row.tsx", new Error("boom in row"))
    expect(appearanceStore.get().runtimeErrors).toHaveLength(1)
    expect(appearanceStore.get().runtimeErrors[0]).toMatchObject({
      packId: "ticket-cards",
      phase: "render",
      slot: "rail.row",
      file: "components/Row.tsx",
      message: "boom in row",
    })

    // Outer boundary disables pack on shell-level crash so default UI recovers
    expect(OuterAppearanceBoundary.getDerivedStateFromError(new Error("shell boom"))).toEqual({ tripped: true })
    disableAppearanceAfterCrash(new Error("shell boom"))
    expect(appearanceStore.get().disabledByCrash).toBe(true)
    expect(appearanceStore.get().activePack).toBeNull()
  })

  test("loadAppearances preserves render errors for the same pack fingerprint when Settings refreshes", async () => {
    const reply: AppearanceListReply = {
      dir: "/home/u/.rove/appearances",
      active: "throwing-slot",
      packs: [
        {
          id: "throwing-slot",
          manifest: { version: 1, name: "Throwing Slot" },
          fingerprint: "fp1",
          hasComponents: false,
          bundleUrl: null,
        },
      ],
      errors: [],
    }
    const client = fakeClient({ "appearance.list": () => reply })
    await loadAppearances(client)
    reportSlotCrash("throwing-slot", "rail.row", "components/CrashRow.tsx", new Error("boom"))
    await loadAppearances(client)
    expect(appearanceStore.get().runtimeErrors).toHaveLength(1)
    expect(appearanceStore.get().runtimeErrors[0]?.message).toBe("boom")
  })
})
