/**
 * `kobe update` black-box behavior + the update.sh package-manager matrix.
 *
 * Pins the bug class: the update must run through the package manager
 * that OWNS the `kobe` on PATH, or the new version lands in another prefix
 * and PATH keeps resolving the stale install. The manager decision lives in
 * scripts/update.sh (fetched remotely by `kobe update`), so the matrix here
 * executes that actual script with a fully shimmed PATH — fake `kobe`, `npm`,
 * `bun` that log their argv — and asserts which manager got the install.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type BehaviorEnv, makeBehaviorEnv, runKobe } from "./harness.ts"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const UPDATE_SH = join(REPO_ROOT, "scripts/update.sh")

describe("kobe update (behavior)", () => {
  let env: BehaviorEnv
  beforeAll(async () => {
    env = await makeBehaviorEnv()
  })
  afterAll(async () => {
    await env.dispose()
  })

  it("--dry-run prints the plan and runs nothing, exit 0", () => {
    const r = runKobe(["update", "--dry-run"], env)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/kobe \d+\.\d+\.\d+ -> latest/)
    expect(r.stdout).toContain("running: curl")
  })

  it("unknown flag lands on the usage surface, exit 2", () => {
    const r = runKobe(["update", "--harf"], env)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain("Usage: kobe update")
  })
})

/**
 * Run scripts/update.sh with PATH shims. `kobeBinDir` decides the manager
 * (a path containing `/.bun/` → bun, else npm). Both managers log to
 * `calls.log` instead of installing anything. `linkTo` makes the on-PATH
 * `kobe` a symlink to that entry file, which is how the script tells a
 * legacy @sma1lboy/kobe install from a migrated one. `arg` is the script's
 * positional argument — a pinned version or a channel/dist-tag.
 */
async function runUpdateScript(
  base: string,
  kobeBinDir: string,
  linkTo?: string,
  arg?: string,
  extraPathDirs: readonly string[] = [],
): Promise<{ code: number; out: string; log: string }> {
  const shims = join(base, "shims")
  await mkdir(shims, { recursive: true })
  await mkdir(kobeBinDir, { recursive: true })
  const logFile = join(base, "calls.log")

  // Post-install `kobe -v` must match `npm view` output or the script exits 1
  // (the shadowed-install guard) — keep both at 9.9.9 for the happy path.
  // Both packages ship a `kobe` AND a `rove` bin, and the script prefers
  // `rove`, so the fixture has to carry both like a real install does.
  for (const name of ["kobe", "rove"]) {
    if (linkTo) {
      await symlink(linkTo, join(kobeBinDir, name))
    } else {
      await writeFile(join(kobeBinDir, name), `#!/bin/sh\necho "${name} 9.9.9"\n`)
      await chmod(join(kobeBinDir, name), 0o755)
    }
  }
  for (const mgr of ["npm", "bun"]) {
    await writeFile(
      join(shims, mgr),
      `#!/bin/sh\necho "${mgr} $@" >> ${logFile}\nif [ "$1" = "view" ]; then echo "9.9.9"; fi\n`,
    )
    await chmod(join(shims, mgr), 0o755)
  }

  const r = spawnSync("sh", arg === undefined ? [UPDATE_SH] : [UPDATE_SH, arg], {
    env: { PATH: [kobeBinDir, ...extraPathDirs, shims, "/usr/bin", "/bin"].join(":") },
    encoding: "utf8",
    timeout: 30_000,
  })
  const log = await readFile(logFile, "utf8").catch(() => "")
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}`, log }
}

describe("scripts/update.sh manager detection", () => {
  let env: BehaviorEnv
  beforeAll(async () => {
    env = await makeBehaviorEnv()
  })
  afterAll(async () => {
    await env.dispose()
  })

  it("a bun-owned kobe (path contains /.bun/) updates via bun", async () => {
    const base = join(env.home, "case-bun")
    const r = await runUpdateScript(base, join(base, ".bun", "bin"))
    expect(r.code).toBe(0)
    expect(r.out).toContain("many sessions. one terminal.")
    expect(r.out).toContain("Thanks for using Rove. Happy building.")
    expect(r.out).toContain("via bun")
    // `--no-cache`: bun's manifest cache serves a stale version for minutes
    // after a publish, so a cached update reports success while installing
    // what was already there.
    expect(r.log).toContain("bun install -g --no-cache @sma1lboy/rove@latest")
    expect(r.log).not.toContain("npm install -g")
  })

  it("any other kobe location updates via npm", async () => {
    const base = join(env.home, "case-npm")
    const r = await runUpdateScript(base, join(base, "npm-global", "bin"))
    expect(r.code).toBe(0)
    expect(r.out).toContain("via npm")
    expect(r.log).toContain("npm install -g @sma1lboy/rove@latest")
    expect(r.log).not.toContain("bun install")
  })

  // A channel name rides the same `pkg@<arg>` slot a version does; npm
  // makes no distinction there.
  it("a channel name installs that dist-tag", async () => {
    const base = join(env.home, "case-channel")
    const r = await runUpdateScript(base, join(base, "npm-global", "bin"), undefined, "nightly")
    expect(r.code).toBe(0)
    expect(r.log).toContain("npm install -g @sma1lboy/rove@nightly")
    expect(r.log).not.toContain("@sma1lboy/rove@latest")
  })

  // The verify step compares the installed `rove -v` against what the target
  // RESOLVES to. A bare dist-tag has to be resolved through the registry
  // first — comparing against the literal string "nightly" would fail every
  // nightly install with a bogus "another install is shadowing it".
  it("resolves a channel through the registry before the shadowed-install check", async () => {
    const base = join(env.home, "case-channel-verify")
    const r = await runUpdateScript(base, join(base, "npm-global", "bin"), undefined, "nightly")
    expect(r.code).toBe(0)
    expect(r.log).toContain("npm view @sma1lboy/rove@nightly version")
    expect(r.out).not.toContain("shadowing")
  })

  // The rename migration: an install whose bin resolves into an
  // @sma1lboy/kobe package dir must be uninstalled BEFORE rove goes in —
  // both packages own a `kobe` and a `rove` bin, so a plain install over
  // the top dies with EEXIST.
  it("a legacy @sma1lboy/kobe install is uninstalled before rove is installed", async () => {
    const base = join(env.home, "case-migrate")
    const pkgDir = join(base, "npm-global/lib/node_modules/@sma1lboy/kobe/dist/cli")
    await mkdir(pkgDir, { recursive: true })
    const entry = join(pkgDir, "kobe.js")
    await writeFile(entry, `#!/bin/sh\necho "kobe 9.9.9"\n`)
    await chmod(entry, 0o755)

    const r = await runUpdateScript(base, join(base, "npm-global", "bin"), entry)
    expect(r.code).toBe(0)
    expect(r.out).toContain("kobe is now Rove.")
    // Both halves of the swap are pinned to the prefix that owns the binary,
    // or the uninstall and the install can hit two different prefixes.
    const prefix = await realpath(join(base, "npm-global"))
    expect(r.log).toContain(`npm uninstall -g --prefix ${prefix} @sma1lboy/kobe`)
    expect(r.log).toContain(`npm install -g --prefix ${prefix} @sma1lboy/rove@latest`)
    // Order matters: uninstall first, or npm bails with EEXIST.
    expect(r.log.indexOf("uninstall")).toBeLessThan(r.log.indexOf("@sma1lboy/rove@latest"))
  })

  it("a non-legacy install is not uninstalled", async () => {
    const base = join(env.home, "case-no-migrate")
    const r = await runUpdateScript(base, join(base, "npm-global", "bin"))
    expect(r.out).not.toContain("kobe is now Rove.")
    expect(r.log).not.toContain("uninstall")
  })

  // The second half of the same bug class. Choosing npm-vs-bun is not enough: with several
  // npm on one machine, `npm install -g` writes to the prefix of whichever
  // node runs npm — not the prefix that owns the binary on PATH. The
  // install must be pinned to the prefix we resolved the binary into.
  it("pins the install to the prefix that owns the binary on PATH", async () => {
    const base = join(env.home, "case-prefix")
    const prefix = join(base, "owning-prefix")
    const pkgDir = join(prefix, "lib/node_modules/@sma1lboy/rove/dist/cli")
    await mkdir(pkgDir, { recursive: true })
    const entry = join(pkgDir, "rove.js")
    await writeFile(entry, `#!/bin/sh\necho "rove 9.9.9"\n`)
    await chmod(entry, 0o755)

    const r = await runUpdateScript(base, join(prefix, "bin"), entry)
    expect(r.code).toBe(0)
    // The script resolves symlinks, and macOS hides /var behind /private/var.
    const real = await realpath(prefix)
    expect(r.log).toContain(`npm install -g --prefix ${real} @sma1lboy/rove@latest`)
  })

  // No prefix to derive (bin is not under a `lib/node_modules` tree) must
  // stay exactly as it was — no --prefix, npm decides.
  it("omits --prefix when the binary is not in an npm global layout", async () => {
    const base = join(env.home, "case-no-prefix")
    const r = await runUpdateScript(base, join(base, "loose", "bin"))
    expect(r.code).toBe(0)
    expect(r.log).toContain("npm install -g @sma1lboy/rove@latest")
    expect(r.log).not.toContain("--prefix")
  })

  // A bun install has no npm prefix to pin; --prefix is npm-only.
  it("never passes --prefix to bun", async () => {
    const base = join(env.home, "case-bun-noprefix")
    const r = await runUpdateScript(base, join(base, ".bun", "bin"))
    expect(r.code).toBe(0)
    expect(r.log).toContain("bun install -g --no-cache @sma1lboy/rove@latest")
    expect(r.log).not.toContain("--prefix")
  })

  // The silent half of the failure: two installs, and the one running is not
  // the one you think. Updating only names the winner, so say so.
  it("warns when a second install is on PATH, naming which one is updated", async () => {
    const base = join(env.home, "case-dupes")
    const prefixA = join(base, "prefix-a")
    const prefixB = join(base, "prefix-b")
    const pkgA = join(prefixA, "lib/node_modules/@sma1lboy/rove/dist/cli")
    const pkgB = join(prefixB, "lib/node_modules/@sma1lboy/rove/dist/cli")
    await mkdir(pkgA, { recursive: true })
    await mkdir(pkgB, { recursive: true })
    for (const entry of [join(pkgA, "rove.js"), join(pkgB, "rove.js")]) {
      await writeFile(entry, `#!/bin/sh\necho "rove 9.9.9"\n`)
      await chmod(entry, 0o755)
    }
    await mkdir(join(prefixB, "bin"), { recursive: true })
    await symlink(join(pkgB, "rove.js"), join(prefixB, "bin", "rove"))

    const r = await runUpdateScript(base, join(prefixA, "bin"), join(pkgA, "rove.js"), undefined, [
      join(prefixB, "bin"),
    ])
    expect(r.code).toBe(0)
    expect(r.out).toContain("rove is installed more than once")
    expect(r.out).toContain(join(prefixA, "bin", "rove"))
    expect(r.out).toContain(join(prefixB, "bin", "rove"))
    // Only the owning prefix is written to.
    const realA = await realpath(prefixA)
    expect(r.log).toContain(`npm install -g --prefix ${realA} @sma1lboy/rove@latest`)
    expect(r.log).not.toContain(await realpath(prefixB))
  })

  it("stays quiet when there is only one install on PATH", async () => {
    const base = join(env.home, "case-single")
    const r = await runUpdateScript(base, join(base, "npm-global", "bin"))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain("installed more than once")
  })

  it("a post-install PATH still resolving a stale version fails loudly", async () => {
    const base = join(env.home, "case-stale")
    const shims = join(base, "shims")
    const bin = join(base, "bin")
    await mkdir(shims, { recursive: true })
    await mkdir(bin, { recursive: true })
    // kobe stays at 1.0.0 while the registry says 9.9.9 → shadowed install.
    await writeFile(join(bin, "kobe"), `#!/bin/sh\necho "kobe 1.0.0"\n`)
    await chmod(join(bin, "kobe"), 0o755)
    for (const mgr of ["npm", "bun"]) {
      await writeFile(join(shims, mgr), `#!/bin/sh\nif [ "$1" = "view" ]; then echo "9.9.9"; fi\n`)
      await chmod(join(shims, mgr), 0o755)
    }
    const r = spawnSync("sh", [UPDATE_SH], {
      env: { PATH: `${bin}:${shims}:/usr/bin:/bin` },
      encoding: "utf8",
      timeout: 30_000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("shadowing")
  })
})

/**
 * Windows leaves npm's retire dir behind. npm moves the old package dir to
 * a sibling `.rove-<hash>` before unpacking the new one and deletes it after;
 * a DLL a running Rove has mapped cannot be deleted on Windows, so the dir
 * survives — and the hash is path-derived, so the NEXT update finds the same
 * dir already there, falls back to a file-by-file copy, and dies with EBUSY
 * on the mapped DLL. The script sweeps those leftovers before npm runs.
 */
describe("scripts/update.sh stale npm retire dirs", () => {
  let env: BehaviorEnv
  beforeAll(async () => {
    env = await makeBehaviorEnv()
  })
  afterAll(async () => {
    await env.dispose()
  })

  /** A Windows-style npm global: shims at the prefix root, node_modules beside them. */
  async function windowsLayout(base: string): Promise<{ binDir: string; scope: string; entry: string }> {
    const binDir = join(base, "npm-global")
    const scope = join(binDir, "node_modules", "@sma1lboy")
    const pkgDir = join(scope, "rove", "dist", "cli")
    await mkdir(pkgDir, { recursive: true })
    const entry = join(pkgDir, "rove.js")
    await writeFile(entry, "// bundle\n")
    return { binDir, scope, entry }
  }

  async function plantRetireDir(scope: string, name: string): Promise<string> {
    const dll = join(scope, name, "node_modules", "@opentui", "core-win32-x64")
    await mkdir(dll, { recursive: true })
    await writeFile(join(dll, "opentui.dll"), "MZ")
    return join(scope, name)
  }

  it("deletes a leftover retire dir before installing (Windows layout, no lib/)", async () => {
    const base = join(env.home, "case-retire-win")
    const { binDir, scope } = await windowsLayout(base)
    const retired = await plantRetireDir(scope, ".rove-xsdjqHxL")
    const legacy = await plantRetireDir(scope, ".kobe-gcMdoyQi")

    const r = await runUpdateScript(base, binDir)
    expect(r.code).toBe(0)
    expect(existsSync(retired)).toBe(false)
    expect(existsSync(legacy)).toBe(false)
    // The live package is untouched and the install still goes through npm.
    expect(existsSync(join(scope, "rove", "dist", "cli", "rove.js"))).toBe(true)
    expect(r.log).toContain("npm install -g @sma1lboy/rove@latest")
  })

  it("deletes a leftover retire dir under a lib/node_modules prefix too", async () => {
    const base = join(env.home, "case-retire-unix")
    const prefix = join(base, "owning-prefix")
    const scope = join(prefix, "lib", "node_modules", "@sma1lboy")
    const pkgDir = join(scope, "rove", "dist", "cli")
    await mkdir(pkgDir, { recursive: true })
    const entry = join(pkgDir, "rove.js")
    await writeFile(entry, `#!/bin/sh\necho "rove 9.9.9"\n`)
    await chmod(entry, 0o755)
    const retired = await plantRetireDir(scope, ".rove-abc12345")

    const r = await runUpdateScript(base, join(prefix, "bin"), entry)
    expect(r.code).toBe(0)
    expect(existsSync(retired)).toBe(false)
    expect(existsSync(entry)).toBe(true)
  })

  // The mapped-DLL case: the delete fails (Windows refuses to unlink a file
  // a process has loaded), so the dir must be moved out of npm's way
  // instead — a rename of a mapped file is allowed, and npm's deterministic
  // retire path is free again.
  it("moves a retire dir aside when it cannot be deleted", async () => {
    const base = join(env.home, "case-retire-mapped")
    const { binDir, scope } = await windowsLayout(base)
    const retired = await plantRetireDir(scope, ".rove-xsdjqHxL")
    // `rm` refuses anything under a retire dir; everything else (the
    // script's own log cleanup) goes to the real rm.
    const shims = join(base, "rm-shim")
    await mkdir(shims, { recursive: true })
    await writeFile(
      join(shims, "rm"),
      `#!/bin/sh\nfor a in "$@"; do case "$a" in *.rove-*) exit 1 ;; esac; done\nexec /bin/rm "$@"\n`,
    )
    await chmod(join(shims, "rm"), 0o755)

    const r = await runUpdateScript(base, binDir, undefined, undefined, [shims])
    expect(r.code).toBe(0)
    expect(existsSync(retired)).toBe(false)
    const aside = (await readdir(scope)).filter((name) => name.startsWith(".rove-xsdjqHxL.stale-"))
    expect(aside).toHaveLength(1)
    expect(existsSync(join(scope, aside[0] as string, "node_modules/@opentui/core-win32-x64/opentui.dll"))).toBe(true)
    expect(r.log).toContain("npm install -g @sma1lboy/rove@latest")
  })

  it("a dir already moved aside is left alone when it still cannot be deleted", async () => {
    const base = join(env.home, "case-retire-aside")
    const { binDir, scope } = await windowsLayout(base)
    const aside = await plantRetireDir(scope, ".rove-xsdjqHxL.stale-4242")
    const shims = join(base, "rm-shim")
    await mkdir(shims, { recursive: true })
    await writeFile(
      join(shims, "rm"),
      `#!/bin/sh\nfor a in "$@"; do case "$a" in *.rove-*) exit 1 ;; esac; done\nexec /bin/rm "$@"\n`,
    )
    await chmod(join(shims, "rm"), 0o755)

    const r = await runUpdateScript(base, binDir, undefined, undefined, [shims])
    expect(r.code).toBe(0)
    expect(existsSync(aside)).toBe(true)
    expect((await readdir(scope)).filter((name) => name.startsWith(".rove-"))).toEqual([".rove-xsdjqHxL.stale-4242"])
  })

  it("names the running-Rove remedy when npm still dies with EBUSY", async () => {
    const base = join(env.home, "case-ebusy")
    const { binDir } = await windowsLayout(base)
    const shims = join(base, "npm-shim")
    await mkdir(shims, { recursive: true })
    await writeFile(
      join(shims, "npm"),
      `#!/bin/sh\nif [ "$1" = "view" ]; then echo "9.9.9"; exit 0; fi\necho "npm error code EBUSY" >&2\necho "npm error EBUSY: resource busy or locked, copyfile 'opentui.dll'" >&2\nexit 1\n`,
    )
    await chmod(join(shims, "npm"), 0o755)

    const r = await runUpdateScript(base, binDir, undefined, undefined, [shims])
    expect(r.code).toBe(1)
    expect(r.out).toContain("npm install failed")
    expect(r.out).toContain("A running Rove is holding files in the old install")
    expect(r.out).toContain("rove daemon stop")
  })
})
