import { preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
/** Distribution contract for the canonical Rove npm package and Rove alias. */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const json = <T>(path: string): T => JSON.parse(read(path)) as T
const SYNC_SCRIPT = "packages/rove-docs/scripts/sync-docs.mjs"
const MODIFIED_MAP = "packages/rove-docs/lib/last-modified.json"

describe("Rove package distribution", () => {
  test.each([
    ["tui", "kanban"],
    ["routines", "routines"],
  ])("the docs build embeds the %s page's %s video from its own static asset tree", (page, video) => {
    execFileSync("bun", [SYNC_SCRIPT], { cwd: ROOT, stdio: "pipe" })

    // Find the page rather than hardcoding its directory: sync-docs.mjs owns
    // the docs/ source -> site slug mapping, and a module split moves pages
    // between subdirectories. Searching keeps
    // this assertion about the VIDEO EMBED instead of the current tree shape.
    const contentRoot = join(ROOT, "packages/rove-docs/content/docs")
    const hits = readdirSync(contentRoot, { recursive: true, encoding: "utf8" }).filter(
      (entry) => entry === `${page}.mdx` || entry.endsWith(`/${page}.mdx`),
    )
    expect(hits, `${page}.mdx should be generated exactly once`).toHaveLength(1)
    const generated = readFileSync(join(contentRoot, hits[0]), "utf8")
    expect(generated).toContain("<video controls playsInline")
    expect(generated).toContain(`poster="/docs-assets/${video}.png"`)
    expect(generated).toContain(`src="/docs-assets/${video}.mp4"`)
    expect(generated).toContain(`](/docs-assets/${video}.mp4)`)
    expect(existsSync(join(ROOT, `packages/rove-docs/public/docs-assets/${video}.mp4`))).toBe(true)
  })

  test("the docs freshness map carries a real date per page, or no date at all", () => {
    execFileSync("bun", [SYNC_SCRIPT], { cwd: ROOT, stdio: "pipe" })

    // Non-empty is the real guard, and CI is where it bites: GitHub Actions
    // and Vercel both check out shallow, where `git log -1 -- <file>` cannot
    // distinguish "changed today" from "fetched today". sync-docs deepens the
    // history rather than emit nothing, and an empty map here means that
    // deepening broke — the site would ship with no freshness signal at all.
    const dates = json<Record<string, string>>(MODIFIED_MAP)
    expect(Object.keys(dates).length).toBeGreaterThan(10)
    // Keys are site paths, values ISO dates.
    expect(
      Object.entries(dates).filter(
        ([path, date]) => !/^\/[a-z0-9/-]*$/.test(path) || !/^\d{4}-\d{2}-\d{2}$/.test(date),
      ),
    ).toEqual([])
  })

  test("the workspace package is canonical Rove while both CLI names remain available", () => {
    const pkg = json<{ name: string; bin: Record<string, string> }>("packages/rove/package.json")

    expect(pkg.name).toBe("@sma1lboy/rove")
    expect(pkg.bin).toEqual({ rove: "dist/cli/rove.js" })
  })

  test("the bin is a node launcher, so npm/npx installs run", () => {
    const launcher = read("packages/rove/src/cli/launcher.ts")

    // `npm install -g` and `npx` start a bin with node, `bun install -g`
    // symlinks it and starts it with Bun. The bin file has one shebang, so
    // it is the node launcher, and the Bun bundle moves to `<name>-run.js`.
    expect(launcher.startsWith("#!/usr/bin/env node")).toBe(true)
    // The launcher runs before any Bun exists: no Bun-only import may reach it.
    expect(launcher).not.toMatch(/from "\.\/(?!bun-runtime)/)
  })

  // Slices the visual-ground-truth job by finding the NEXT top-level job, or
  // end-of-file when it is the last one. Naming a specific successor job made
  // this test fail the moment that job was deleted (`coverage-cap`), which said
  // nothing about the property under test: build must run before the visual
  // step, inside that job.
  test.each([".github/workflows/ci.yml", ".github/workflows/release.yml"])(
    "%s builds the Rove artifacts before the visual journey",
    (path) => {
      const workflow = read(path)
      const start = workflow.indexOf("\n  visual-ground-truth:")
      expect(start, `${path} has no visual-ground-truth job`).toBeGreaterThanOrEqual(0)
      const nextJob = /\n {2}[a-z][a-z0-9-]*:\n/.exec(workflow.slice(start + 1))
      const job = nextJob ? workflow.slice(start, start + 1 + nextJob.index) : workflow.slice(start)
      const build = job.indexOf("name: Build canonical Rove artifacts")
      const visual = job.indexOf("name: Visual journey (browser → PTY → real OpenTUI)")

      expect(build, `${path} does not build dist/ before visual tests`).toBeGreaterThanOrEqual(0)
      expect(visual, `${path} has no visual journey step`).toBeGreaterThan(build)
    },
  )

  test("workspace commands address the canonical package name", () => {
    const root = json<{ scripts: Record<string, string> }>("package.json")
    const commands = Object.values(root.scripts)

    expect(commands.some((command) => command.includes("--filter @sma1lboy/rove"))).toBe(true)
    // The SDK build must stay in postinstall (the exec-bit backstop runs ahead of it).
    expect(root.scripts.postinstall).toMatch(/bun --filter @sma1lboy\/rove-plugin-sdk build$/)
    expect(root.scripts.build).toMatch(/^bun --filter @sma1lboy\/rove-plugin-sdk build && /)
  })

  test("the published package declares node-pty even though rove's own source never imports it", () => {
    // The runtime consumer is rove-daemon (pty-driver.ts's `import("node-pty")`,
    // shipped as dist/cli/pty-host-node.mjs with node-pty external). But
    // @sma1lboy/rove-daemon is private and never published — its dependencies
    // reach no user install. The ONLY thing that puts node-pty on disk under an
    // installed @sma1lboy/rove is this declaration; removing it breaks the
    // Windows ConPTY host with MODULE_NOT_FOUND (verified against a packed
    // tarball installed into a clean npm prefix). knip flags it as
    // unused because it cannot see the dynamic import — that is a false
    // positive, suppressed in knip.json, not a license to delete.
    //
    // Optional, not required: only Windows loads it. node-pty@1.1.0 ships no
    // linux prebuild, so as a hard dependency a Linux box without a C++
    // toolchain failed the whole `npm i -g` compiling a module it never uses.
    const pkg = json<{ dependencies: Record<string, string>; optionalDependencies?: Record<string, string> }>(
      "packages/rove/package.json",
    )
    const knip = json<{ ignoreDependencies?: string[] }>("packages/rove/knip.json")

    expect(pkg.optionalDependencies?.["node-pty"]).toBeDefined()
    expect(pkg.dependencies["node-pty"]).toBeUndefined()
    expect(knip.ignoreDependencies).toContain("node-pty")
  })

  test("daemon typechecking does not rely on the renamed package's hoisted dependencies", () => {
    const daemon = json<{ devDependencies: Record<string, string> }>("packages/rove-daemon/package.json")
    const rove = json<{ devDependencies: Record<string, string> }>("packages/rove/package.json")

    // The invariant is "daemon carries its OWN pin, in lockstep with rove's" —
    // not a specific version. A frozen literal turns every routine @types/node
    // bump into an unrelated red.
    expect(daemon.devDependencies["@types/node"]).toBeDefined()
    expect(daemon.devDependencies["@types/node"]).toBe(rove.devDependencies["@types/node"])
  })

  test("the plugin SDK workspace and daemon dependency use the canonical Rove package", () => {
    const sdk = json<{
      name: string
      exports: Record<string, { types: string; default: string }>
    }>("packages/rove-plugin-sdk/package.json")
    const daemon = json<{ dependencies: Record<string, string> }>("packages/rove-daemon/package.json")

    expect(sdk.name).toBe("@sma1lboy/rove-plugin-sdk")
    expect(sdk.exports["./contract"]).toEqual({
      types: "./dist/contract.d.ts",
      default: "./dist/contract.js",
    })
    expect(daemon.dependencies["@sma1lboy/rove-plugin-sdk"]).toBe("workspace:*")
  })

  test("release publishes only the canonical plugin SDK", () => {
    const workflow = read(".github/workflows/release.yml")
    const publish = workflow.indexOf("Publish canonical plugin SDK")
    expect(publish).toBeGreaterThanOrEqual(0)
    expect(workflow.indexOf("Create GitHub release")).toBeGreaterThan(publish)
    expect(workflow).not.toContain("Publish plugin SDK compatibility alias")
  })

  test("pending changesets version the canonical package", () => {
    const retired = preRenameStateDir("").slice(1)
    const files = readdirSync(join(ROOT, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md")
    expect(files.filter((file) => read(join(".changeset", file)).toLowerCase().includes(retired))).toEqual([])
  })

  test.each([
    "README.md",
    "docs/CLI.md",
    "docs/QUICKSTART.md",
    "docs/RELEASING.md",
    "packages/rove/README.md",
    "packages/rove-landing/index.html",
    "packages/rove-landing/changelog.html",
    "packages/rove-landing/plugins.html",
    "packages/rove-landing/themes.html",
  ])("install surface %s points new users at Rove", (path) => {
    expect(read(path).toLowerCase()).not.toContain(preRenameStateDir("").slice(1))
  })

  test.each([
    ".claude/skills/changelog-generator/SKILL.md",
    ".claude/skills/recent-release/SKILL.md",
    "CONTRIBUTING.md",
    "README.md",
    "docs/themes.md",
    "packages/rove-plugin-sdk/README.md",
    "packages/rove-plugin-sdk/package.json",
    "packages/rove-docs/lib/layout.shared.tsx",
    "packages/rove-docs/scripts/sync-docs.mjs",
    "packages/rove-landing/TODOS.md",
    "packages/rove-landing/changelog.html",
    "packages/rove-landing/index.html",
    "packages/rove-landing/index.js",
    "packages/rove-landing/plugins.html",
    "packages/rove-landing/themes.html",
    "packages/rove-landing/themes/catppuccin.json",
    "packages/rove-landing/themes/everforest.json",
    "packages/rove-landing/themes/gruvbox.json",
    "packages/rove-landing/themes/kanagawa.json",
    "packages/rove-landing/themes/rose-pine.json",
    "packages/rove-landing/themes/solarized.json",
    "packages/rove/scripts/build.ts",
    "packages/rove/src/cli/theme.ts",
    "packages/rove/src/tui/context/theme/theme.schema.json",
    "scripts/release.sh",
  ])("%s links the canonical Rove repository", (path) => {
    expect(read(path)).toMatch(/sma1lboy\/rove/i)
  })

  test("landing pages load their extracted static assets", () => {
    const home = read("packages/rove-landing/index.html")
    const themes = read("packages/rove-landing/themes.html")

    // Match the REFERENCE, not its exact spelling: `defer`/`async` are
    // performance attributes a page may legitimately gain, and pinning the
    // literal tag turns that into a failure.
    expect(home).toMatch(/<script[^>]+src="\/index\.js"/)
    expect(themes).toContain('<link rel="stylesheet" href="/themes.css">')
    expect(themes).toMatch(/<script[^>]+src="\/themes\.js"/)
  })
})
