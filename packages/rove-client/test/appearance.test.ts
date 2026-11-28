import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  APPEARANCE_SLOTS,
  interpolateSlotTemplate,
  resolveAppearanceCssColors,
  resolveAppearanceEngineColors,
  validateAppearanceManifest,
} from "../src/appearance/index.ts"
import {
  APPEARANCE_MANIFEST_FILE,
  loadAppearancePack,
  loadUserAppearances,
  userAppearancesDir,
} from "../src/appearance/loader.ts"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "rove-appearance-test-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("validateAppearanceManifest", () => {
  test("accepts a full valid manifest with theme, colors, layout, fields, tree, and component slots", () => {
    const res = validateAppearanceManifest({
      version: 1,
      name: "Ticket Cards",
      description: "Card layout with engine-tinted task rows",
      author: "Rove",
      theme: "claude",
      colors: {
        defs: {
          warm: "#cc785c",
          cool: "rgb(97, 170, 242)",
        },
        tokens: {
          paper: { dark: "#111110", light: "#faf9f5" },
          accent: "warm",
          info: "cool",
        },
        engineColors: {
          claude: { dark: "#cc785c", light: "#b95d3e" },
          codex: "cool",
        },
      },
      layout: {
        frame: "cards",
        paneGap: 10,
        shellPadding: 10,
        radius: 12,
        radiusSm: 8,
        radiusXs: 4,
        density: "comfortable",
        railWidth: 280,
        borderStyle: "hairline",
        statusBar: "always",
      },
      slots: {
        "rail.row": {
          fields: ["title", "pr", "status"],
          secondaryFields: ["branch", "engine", "age"],
          surface: "engineTint",
          variant: "card",
        },
        "rail.footer": {
          tree: {
            type: "box",
            direction: "row",
            gap: 1,
            children: [{ type: "text", text: "Usage: {{usageSummary}}", tone: "muted" }],
          },
        },
        "panel.section": {
          component: "components/InspectorSection.tsx",
          export: "InspectorSection",
        },
        "status.bar": {
          hidden: true,
        },
      },
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.manifest.name).toBe("Ticket Cards")
    expect(res.manifest.layout?.frame).toBe("cards")
    expect(res.manifest.slots?.["rail.row"]?.secondaryFields).toEqual(["branch", "engine", "age"])
    expect(res.manifest.slots?.["panel.section"]?.export).toBe("InspectorSection")
  })

  test("rejects unknown keys at top-level, layout, colors, and slots with exact paths", () => {
    const res = validateAppearanceManifest({
      version: 1,
      name: "Bad Keys",
      extraTop: true,
      layout: { frame: "cards", unknownGap: 8 },
      colors: { tokens: { backgroud: "#000000" }, extraColorSection: {} },
      slots: {
        "rail.row": { fields: ["title"], bogusProp: 1 },
        "rail.unknown": { hidden: true },
      },
    })

    expect(res.ok).toBe(false)
    if (res.ok) return
    const paths = res.issues.map((i) => i.path)
    expect(paths).toContain("extraTop")
    expect(paths).toContain("layout.unknownGap")
    expect(paths).toContain("colors.extraColorSection")
    expect(paths).toContain("colors.tokens.backgroud")
    expect(paths).toContain("slots.rail.row.bogusProp")
    expect(paths).toContain("slots.rail.unknown")
    expect(res.summary).toContain('unknown key "extraTop"')
    expect(res.summary).toContain('unknown color token "backgroud"')
    expect(res.summary).toContain('unknown slot "rail.unknown"')
  })

  test("rejects bad types, out-of-range layout values, bad rgb literals, and unresolved/cyclic defs", () => {
    const res = validateAppearanceManifest({
      version: 2,
      name: "",
      layout: { paneGap: 99, density: "huge", railWidth: 100.5 },
      colors: {
        defs: { a: "b", b: "a", badRgb: "rgb(300, 0, 0)" },
        tokens: { accent: "missingDef", paper: { dark: "#111" } },
      },
      slots: {
        "rail.row": {
          fields: ["title", "nonexistent", "title"],
          component: "../escape.tsx",
        },
        "panel.tabs": {
          tree: { type: "script", text: "nope" },
        },
      },
    })

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.issues.some((i) => i.path === "version")).toBe(true)
    expect(res.issues.some((i) => i.path === "name")).toBe(true)
    expect(res.issues.some((i) => i.path === "layout.paneGap" && i.message.includes("0 and 32"))).toBe(true)
    expect(res.issues.some((i) => i.path === "layout.density")).toBe(true)
    expect(res.issues.some((i) => i.path === "layout.railWidth")).toBe(true)
    expect(res.issues.some((i) => i.path === "colors.defs.a" && i.message.includes("cyclic"))).toBe(true)
    expect(res.issues.some((i) => i.path === "colors.defs.badRgb" && i.message.includes("rgb()"))).toBe(true)
    expect(res.issues.some((i) => i.path === "colors.tokens.accent" && i.message.includes("missingDef"))).toBe(true)
    expect(res.issues.some((i) => i.path === "colors.tokens.paper.light")).toBe(true)
    expect(res.issues.some((i) => i.path === "slots.rail.row.fields[1]" && i.message.includes("nonexistent"))).toBe(
      true,
    )
    expect(res.issues.some((i) => i.path === "slots.rail.row.fields[2]" && i.message.includes("duplicate"))).toBe(true)
    expect(res.issues.some((i) => i.path === "slots.rail.row.component" && i.message.includes("components/"))).toBe(
      true,
    )
    expect(res.issues.some((i) => i.path === "slots.panel.tabs.tree" && i.message.includes("unknown element"))).toBe(
      true,
    )
  })

  test("rejects contradictory slot configurations", () => {
    const res = validateAppearanceManifest({
      version: 1,
      name: "Conflict",
      slots: {
        "rail.row": {
          component: "components/Row.tsx",
          tree: { type: "text", text: "hi" },
        },
        "rail.footer": {
          hidden: true,
          tree: { type: "text", text: "hi" },
        },
        "status.bar": {
          export: "Bar",
        },
      },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.issues.some((i) => i.path === "slots.rail.row" && i.message.includes("both"))).toBe(true)
    expect(res.issues.some((i) => i.path === "slots.rail.footer" && i.message.includes("hidden"))).toBe(true)
    expect(res.issues.some((i) => i.path === "slots.status.bar.export" && i.message.includes("requires"))).toBe(true)
  })

  test("resolves mode-aware color tokens, engine colors, and template interpolation", () => {
    const colors = {
      defs: { brand: "#cc785c", inkDark: "#eae7df" },
      tokens: {
        accent: "brand",
        paper: { dark: "#111110", light: "#faf9f5" },
      },
      engineColors: {
        claude: { dark: "brand", light: "#a94c2c" },
      },
    } as const

    expect(resolveAppearanceCssColors(colors, "dark")).toEqual({
      "--accent": "#cc785c",
      "--paper": "#111110",
    })
    expect(resolveAppearanceCssColors(colors, "light")).toEqual({
      "--accent": "#cc785c",
      "--paper": "#faf9f5",
    })
    expect(resolveAppearanceEngineColors(colors, "dark")).toEqual({ claude: "#cc785c" })
    expect(resolveAppearanceEngineColors(colors, "light")).toEqual({ claude: "#a94c2c" })
    expect(interpolateSlotTemplate("{{branch}} · {{missing}} ({{count}})", { branch: "main", count: 3 })).toBe(
      "main ·  (3)",
    )
    expect(APPEARANCE_SLOTS).toContain("rail.row")
    expect(APPEARANCE_SLOTS).toContain("panel.section")
  })
})

describe("loadUserAppearances & loadAppearancePack", () => {
  test("returns empty packs and errors when appearances dir does not exist", () => {
    withTempDir((root) => {
      const dir = userAppearancesDir(root)
      expect(dir).toBe(join(root, ".rove", "appearances"))
      const loaded = loadUserAppearances(dir)
      expect(loaded.packs).toEqual([])
      expect(loaded.errors).toEqual([])
    })
  })

  test("loads valid packs, computes changing fingerprints, and reports broken packs without throwing", () => {
    withTempDir((root) => {
      const appearancesDir = userAppearancesDir(root)
      // 1. Valid pack with component
      const goodDir = join(appearancesDir, "ticket-cards")
      mkdirSync(join(goodDir, "components"), { recursive: true })
      const compPath = join(goodDir, "components", "Row.tsx")
      writeFileSync(compPath, "export default function Row() { return null }\n")
      writeFileSync(
        join(goodDir, APPEARANCE_MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          name: "Ticket Cards",
          slots: { "rail.row": { component: "components/Row.tsx" } },
        }),
      )

      // 2. Broken JSON pack
      const badJsonDir = join(appearancesDir, "bad-json")
      mkdirSync(badJsonDir, { recursive: true })
      writeFileSync(join(badJsonDir, APPEARANCE_MANIFEST_FILE), "{ not json")

      // 3. Missing component file
      const missingCompDir = join(appearancesDir, "missing-comp")
      mkdirSync(missingCompDir, { recursive: true })
      writeFileSync(
        join(missingCompDir, APPEARANCE_MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          name: "Missing Component",
          slots: { "rail.row": { component: "components/DoesNotExist.tsx" } },
        }),
      )

      // 4. Reserved name "default"
      const reservedDir = join(appearancesDir, "default")
      mkdirSync(reservedDir, { recursive: true })
      writeFileSync(join(reservedDir, APPEARANCE_MANIFEST_FILE), JSON.stringify({ version: 1, name: "Default" }))

      const first = loadUserAppearances(appearancesDir)
      expect(first.packs.map((p) => p.id)).toEqual(["ticket-cards"])
      expect(first.packs[0]?.components).toHaveLength(1)
      expect(first.packs[0]?.components[0]?.slot).toBe("rail.row")

      expect(first.errors.map((e) => `${e.id}:${e.kind}`).sort()).toEqual([
        "bad-json:json",
        "default:name",
        "missing-comp:component",
      ])
      expect(first.errors.find((e) => e.id === "missing-comp")?.slot).toBe("rail.row")

      // Editing the component file changes the fingerprint so hard refresh reloads it.
      writeFileSync(compPath, "export default function Row() { return 'updated' }\n")
      const bumped = new Date(Date.now() + 2000)
      utimesSync(compPath, bumped, bumped)
      const second = loadAppearancePack(goodDir, "ticket-cards")
      expect(second.ok).toBe(true)
      if (second.ok) expect(second.pack.fingerprint).not.toBe(first.packs[0]?.fingerprint)
    })
  })

  test("rejects component symlinks that point outside the pack directory", () => {
    withTempDir((root) => {
      const outside = join(root, "outside.tsx")
      writeFileSync(outside, "export default () => null\n")
      const packDir = join(root, "escape-pack")
      mkdirSync(join(packDir, "components"), { recursive: true })
      symlinkSync(outside, join(packDir, "components", "Evil.tsx"))
      writeFileSync(
        join(packDir, APPEARANCE_MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          name: "Escape",
          slots: { "rail.row": { component: "components/Evil.tsx" } },
        }),
      )
      const res = loadAppearancePack(packDir, "escape-pack")
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.kind).toBe("component")
        expect(res.error.message).toContain("outside the pack directory")
      }
    })
  })
})
