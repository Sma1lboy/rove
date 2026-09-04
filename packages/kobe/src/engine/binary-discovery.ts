/**
 * How to probe for a vendor's CLI binary. Each `<vendor>-local/binary.ts`
 * owns only WHERE to look; this file owns the probing itself — the `which`
 * call and its macOS alias unwrapping, the stat-based existence check, the
 * `checkedPaths` ledger that ends up in the user-facing error, and the
 * injection seam the tests drive.
 *
 * Every vendor's search ORDER is different and deliberately so (claude walks
 * `~/.nvm/versions/node/*` newest-first, codex tries homebrew before NVM,
 * kimi looks in its installer's own dir first, copilot expands `.exe`/`.cmd`
 * spellings on Windows). Those lists stay in the vendor files, verbatim.
 */

import { spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"

/**
 * Optional FS/env injection for tests. Real callers don't need to pass this.
 * `readdir` and `platform` are optional because only claude and copilot
 * respectively consult them.
 */
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
    // We deliberately use `command -v` style via `which`/`where` rather
    // than scanning PATH ourselves: shells often have aliases or
    // shims that show up under `which` but not under a naive PATH walk.
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
 * Base of the four per-vendor not-found errors. The message lists every path
 * that was checked, in probe order, so a user can see why discovery failed;
 * subclasses supply the label and the install hint and keep their own `name`.
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

export interface BinaryFinderSpec {
  /** The binary name handed to `which`. */
  readonly name: string
  /** Absolute paths to stat, in probe order, after the `which` hit fails. */
  candidates(ctx: BinaryCandidateContext): readonly string[]
  /** Built when nothing matched, from the ordered ledger of probed paths. */
  notFound(checkedPaths: readonly string[]): BinaryNotFoundError
}

/**
 * Build a vendor's finder. The returned function resolves with an absolute
 * path, or rejects with the vendor's {@link BinaryNotFoundError}.
 *
 * Cheap (one `which`, a handful of stats) and pure aside from filesystem
 * reads — safe to call once per spawn. Callers wanting caching can wrap it.
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
