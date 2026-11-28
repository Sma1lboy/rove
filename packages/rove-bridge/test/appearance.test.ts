import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAppearancePack, loadUserAppearances } from "@sma1lboy/rove-client/appearance/loader.ts"
import { bundleAppearancePack, clearAppearanceBundleCache, serveAppearanceBundle } from "../src/appearance-bundle.ts"
import { type AppearanceListReply, createAppearanceOps } from "../src/ops/appearance.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"

const api: BridgeApi = { verb: async () => ({}) as never, rpc: async () => ({}) as never }
const call = (table: OpTable, op: string, args: Args = {}) =>
  (table[op] as NonNullable<OpTable[string]>).run(args, { api })

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "rove-bridge-appearance-"))
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }))
}

afterEach(() => clearAppearanceBundleCache())

describe("appearance bundling & ops", () => {
  test("bundles custom TSX component with host React shim and serves it over HTTP", async () => {
    await withTempDir(async (root) => {
      const packDir = join(root, "ticket-pack")
      mkdirSync(join(packDir, "components"), { recursive: true })
      writeFileSync(
        join(packDir, "components", "Row.tsx"),
        `import { useState } from "react"
import { ui } from "@rove/appearance"
export default function Row(props: { data: { title: string } }) {
  const [n] = useState(1)
  return <div data-n={n} data-has-btn={Boolean(ui.Button)}>{props.data.title}</div>
}
`,
      )
      writeFileSync(
        join(packDir, "appearance.json"),
        JSON.stringify({
          version: 1,
          name: "Ticket Pack",
          slots: { "rail.row": { component: "components/Row.tsx" } },
        }),
      )

      const loaded = loadAppearancePack(packDir, "ticket-pack")
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return

      const built = await bundleAppearancePack(loaded.pack)
      expect(built.ok).toBe(true)
      if (!built.ok) return
      expect(built.code).toContain("__ROVE_APPEARANCE_HOST__")
      expect(built.code).toContain("rail.row")

      const res = await serveAppearanceBundle(new Request("http://127.0.0.1/appearances/ticket-pack/bundle.js"), root)
      expect(res?.status).toBe(200)
      expect(res?.headers.get("Content-Type")).toContain("application/javascript")
      expect(res?.headers.get("Cache-Control")).toBe("no-store")
      const js = await res?.text()
      expect(js).toContain("rail.row")
    })
  })

  test("reports syntax errors in custom components and validation errors in appearance.list", async () => {
    await withTempDir(async (root) => {
      const brokenComp = join(root, "broken-tsx")
      mkdirSync(join(brokenComp, "components"), { recursive: true })
      writeFileSync(join(brokenComp, "components", "Bad.tsx"), "export default function Bad( { return <div /> }\n")
      writeFileSync(
        join(brokenComp, "appearance.json"),
        JSON.stringify({
          version: 1,
          name: "Broken TSX",
          slots: { "rail.row": { component: "components/Bad.tsx" } },
        }),
      )

      const badManifest = join(root, "bad-manifest")
      mkdirSync(badManifest, { recursive: true })
      writeFileSync(join(badManifest, "appearance.json"), JSON.stringify({ version: 1, name: "Bad", unknownKey: 123 }))

      const state: Record<string, unknown> = {}
      const ops = createAppearanceOps({
        loadState: () => ({ ...state }),
        updateState: (compute) => Object.assign(state, compute({ ...state })),
        scan: () => loadUserAppearances(root),
      })

      const listed = (await call(ops, "appearance.list")) as AppearanceListReply
      expect(listed.active).toBe("default")
      expect(listed.packs).toHaveLength(1)
      expect(listed.packs[0]?.id).toBe("broken-tsx")
      expect(listed.packs[0]?.bundleUrl).toBeNull()
      expect(listed.packs[0]?.bundleError?.file).toContain("Bad.tsx")
      expect(listed.errors).toHaveLength(1)
      expect(listed.errors[0]?.id).toBe("bad-manifest")
      expect(listed.errors[0]?.message).toContain('unknown key "unknownKey"')

      // appearance.set persists valid ids and allows resetting to default
      const updated = (await call(ops, "appearance.set", { id: "broken-tsx" })) as AppearanceListReply
      expect(updated.active).toBe("broken-tsx")
      expect(state["appearance.pack"]).toBe("broken-tsx")

      const reset = (await call(ops, "appearance.set", { id: "default" })) as AppearanceListReply
      expect(reset.active).toBe("default")

      await expect(call(ops, "appearance.set", { id: "../escape" })).rejects.toMatchObject({ code: "BAD_ARGS" })

      // HTTP endpoint returns 422 on bundle failure and 404 on unknown pack
      const badRes = await serveAppearanceBundle(new Request("http://127.0.0.1/appearances/broken-tsx/bundle.js"), root)
      expect(badRes?.status).toBe(422)
      const missingRes = await serveAppearanceBundle(
        new Request("http://127.0.0.1/appearances/no-such-pack/bundle.js"),
        root,
      )
      expect(missingRes?.status).toBe(404)
    })
  })
})
