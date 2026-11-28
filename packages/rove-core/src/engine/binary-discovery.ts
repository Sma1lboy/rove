/**
 * Vendor CLI binary probing: `which` (+ macOS alias unwrapping), stat check,
 * the `checkedPaths` ledger for the error, and the test seam. Each
 * `<vendor>-local/binary.ts` owns only WHERE to look; the search orders
 * differ on purpose and stay in the vendor files.
 */

import { spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/** FS/env injection for tests. `readdir`/`platform` are optional: only claude/copilot consult them. */
export interface BinaryDiscoveryDeps {
  /** Returns true if the path exists and is a regular file (or symlink to one). */
  fileExists(p: string): boolean
  /** Returns the value of a process env var, or undefined. */
  env(name: string): string | undefined
  /** Returns the user's home directory. */
  home(): string
  /** Runs `which <name>` (or `where` on Windows) and returns the first matching path, or undefined. */
  which(name: string): string | undefined
  /** Lists immediate child names of a directory, or returns []. */
  readdir?(p: string): string[]
  /** The host platform, for vendors whose candidate list is platform-shaped. */
  platform?(): NodeJS.Platform
}

const defaultBinaryDeps: BinaryDiscoveryDeps = {
  fileExists(p) {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  env(name) {
    return process.env[name]
  },
  home() {
    return homedir()
  },
  which(name) {
    // Not a PATH walk: aliases and shims show up only under `which`.
    const cmd = process.platform === "win32" ? "where" : "which"
    const out = spawnSync(cmd, [name], { encoding: "utf8" })
    if (out.status !== 0) return undefined
    const first = out.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0]
    if (!first) return undefined
    // macOS `which` may print "<name>: aliased to /path" for shell aliases.
    if (first.startsWith(`${name}:`) && first.includes("aliased to")) {
      const aliasTarget = first.split("aliased to")[1]?.trim()
      return aliasTarget && existsSync(aliasTarget) ? aliasTarget : undefined
    }
    return first
  },
  readdir(p) {
    try {
      // A lazy `require` rather than a static import: the nvm scan must list
      // the REAL disk even in suites that virtualize `node:fs` for statSync.
      const fs = require("node:fs") as typeof import("node:fs")
      return fs.readdirSync(p)
    } catch {
      return []
    }
  },
}

/**
 * Base of the per-vendor not-found errors; the message lists every checked
 * path in probe order. Subclasses supply label, hint, and their own `name`.
 */
export class BinaryNotFoundError extends Error {
  readonly checkedPaths: readonly string[]
  constructor(label: string, hint: string, checkedPaths: readonly string[]) {
    super(`${label} not found. Checked: ${checkedPaths.join(", ")}. ${hint}`)
    this.name = "BinaryNotFoundError"
    this.checkedPaths = checkedPaths
  }
}

/** What a vendor's candidate list gets to look at. */
interface BinaryCandidateContext {
  readonly deps: BinaryDiscoveryDeps
  /** `deps.home()`, resolved once. */
  readonly home: string
}

/** Ordered install locations; callers select groups when their CLI uses a different order. */
export function npmStyleDirs(
  { deps, home }: BinaryCandidateContext,
  locations: readonly (
    | "system"
    | "homebrew"
    | "nvm"
    | "windowsNpm"
    | "npmGlobal"
    | "local"
    | "yarn"
    | "bun"
    | "bin"
  )[] = ["system", "nvm", "windowsNpm", "npmGlobal", "local", "bun", "bin"],
): string[] {
  return locations.flatMap((location) => {
    switch (location) {
      case "system":
        return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
      case "homebrew":
        return ["/opt/homebrew/bin", "/usr/local/bin"]
      case "nvm": {
        const bin = deps.env("NVM_BIN")
        return bin ? [bin] : []
      }
      case "windowsNpm": {
        if ((deps.platform?.() ?? process.platform) !== "win32") return []
        const appData = deps.env("APPDATA")
        const localAppData = deps.env("LOCALAPPDATA")
        return [
          ...(localAppData ? [path.join(localAppData, "npm")] : []),
          ...(appData ? [path.join(appData, "npm")] : []),
          path.join(home, "AppData/Roaming/npm"),
        ]
      }
      case "npmGlobal":
        return [path.join(home, ".npm-global/bin")]
      case "local":
        return [path.join(home, ".local/bin")]
      case "yarn":
        return [path.join(home, ".yarn/bin")]
      case "bun":
        return [path.join(home, ".bun/bin")]
      case "bin":
        return [path.join(home, "bin")]
    }
  })
}

/** `name` under every npm-style dir, each spelling the platform uses (`.exe`/`.cmd` on Windows). */
export function npmStyleBinaryCandidates(ctx: BinaryCandidateContext, name: string): string[] {
  const win32 = (ctx.deps.platform?.() ?? process.platform) === "win32"
  const names = win32 ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  return npmStyleDirs(ctx).flatMap((dir) => names.map((n) => path.join(dir, n)))
}

export interface BinaryFinderSpec {
  /** The binary name handed to `which`. */
  readonly name: string
  /** Absolute paths to stat, in probe order, after the `which` hit fails. */
  candidates(ctx: BinaryCandidateContext): readonly string[]
  /** Built when nothing matched, from the ordered ledger of probed paths. */
  notFound(checkedPaths: readonly string[]): BinaryNotFoundError
}

/**
 * Build a vendor's finder: resolves an absolute path or rejects with its
 * {@link BinaryNotFoundError}. Uncached (one `which`, a few stats).
 */
export function createBinaryFinder(spec: BinaryFinderSpec): (deps?: BinaryDiscoveryDeps) => Promise<string> {
  return async function findBinary(deps: BinaryDiscoveryDeps = defaultBinaryDeps): Promise<string> {
    const checked: string[] = []

    // 1. $PATH via `which` (user's shell PATH, including aliases). The
    //    `which:` sentinel distinguishes it from a plain stat in the ledger.
    const whichResult = deps.which(spec.name)
    if (whichResult) {
      checked.push(`which:${whichResult}`)
      if (deps.fileExists(whichResult)) return whichResult
    }

    // 2. The vendor's own list, first hit wins.
    for (const candidate of spec.candidates({ deps, home: deps.home() })) {
      checked.push(candidate)
      if (deps.fileExists(candidate)) return candidate
    }

    throw spec.notFound(checked)
  }
}
