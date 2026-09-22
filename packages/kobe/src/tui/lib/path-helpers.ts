/**
 * Partial-path → suggestion helpers for the new-task dialog's browse picker
 * and `quick-task`. Synchronous fs only (readdir/stat on one directory, per
 * keystroke), never a subprocess — shelling out belongs in `./git-snapshot.ts`
 * (sync, whitelisted) or an async spawn helper.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import { pathSyntax } from "@sma1lboy/kobe-daemon/path-identity"
import { tildify } from "../../lib/path-home"

/**
 * Last path segment — the shared leaf-name extractor (history header, Ops
 * preview, diff-tab labels, split leaves). Trailing slash → `""`, no slash →
 * the whole string.
 */
export function pathLeaf(p: string): string {
  return p.slice(lastSeparator(p) + 1)
}

function lastSeparator(p: string): number {
  return pathSyntax(p).sep === "\\" || (process.platform === "win32" && !p.startsWith("/"))
    ? Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
    : p.lastIndexOf("/")
}

/**
 * Expand `~` and `~/...` (no `~user/`). The fs/git helpers don't expand `~`,
 * so resolve before validating or spawning git.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\"))) return os.homedir() + p.slice(1)
  return p
}

/**
 * Tasks are filed under their repo path, so `/i/rove/` and `/i/rove` would
 * file two repos. Strip where text becomes an answer, never in the field —
 * while typing, the slash points the picker at children. Root stays `/`.
 */
export function stripTrailingSlash(p: string): string {
  const root = pathSyntax(p).parse(p).root
  let end = p.length
  while (end > root.length && lastSeparator(p.slice(0, end)) === end - 1) end--
  return p.slice(0, end)
}

export type PathSplit = { base: string; filter: string }

/**
 * `base` = directory to readdir (ends with `/`, or empty); `filter` = the
 * partial leaf (case-insensitive prefix match):
 *
 *   `/Users/`           → { base: "/Users/", filter: "" }
 *   `/Users/me/proj`    → { base: "/Users/me/", filter: "proj" }
 *   `~/p`               → { base: "<home>/", filter: "p" }
 *   `~`                 → { base: "<home>/", filter: "" }
 *   `relative/path`     → { base: "relative/", filter: "path" }
 *   `foo`               → { base: "", filter: "foo" }
 *
 * `~` is expanded for readdir; restoring `~/` in the input is `joinDrill`'s job.
 */
export function splitPathForDirSuggest(value: string): PathSplit {
  if (!value) return { base: "", filter: "" }
  // Treat bare `~` as `~/` so we list the home directory.
  const normalized = value === "~" ? "~/" : value
  const expanded = expandHome(normalized)
  const lastSlash = lastSeparator(expanded)
  if (lastSlash === -1) return { base: "", filter: expanded }
  return { base: expanded.slice(0, lastSlash + 1), filter: expanded.slice(lastSlash + 1) }
}

/**
 * Direct subdirectories of `base`, sorted; [] on any fs error so the picker
 * degrades to free text. Hidden entries are kept — `filterSubdirs` hides them.
 */
export function listSubdirs(base: string): readonly string[] {
  if (!base) return []
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.isDirectory()) out.push(e.name)
    }
    return out.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * Case-insensitive PREFIX match (`proj` finds `projects/`, not `my-projects/`,
 * like shell completion); `.` entries hidden unless the filter starts with `.`,
 * like `ls`.
 */
export function filterSubdirs(all: readonly string[], filter: string): readonly string[] {
  const f = filter.toLowerCase()
  const showHidden = f.startsWith(".")
  const visible = showHidden ? all : all.filter((n) => !n.startsWith("."))
  if (!f) return visible
  return visible.filter((n) => n.toLowerCase().startsWith(f))
}

/** Input value after drilling into `name`; keeps a typed `~/` prefix (`baseExpanded` is the real path). */
export function joinDrill(typedValue: string, baseExpanded: string, name: string): string {
  const out = `${baseExpanded + name}/`
  if (typedValue.startsWith("~")) {
    const short = tildify(out)
    if (short.startsWith("~")) return short === "~" ? "~/" : `${short}/`
  }
  return out
}

/**
 * Input value after SELECTING `name` (Enter/click): no trailing slash, so the
 * dropdown collapses instead of listing children. Keeps `~/` like {@link joinDrill}.
 */
export function joinPicked(typedValue: string, baseExpanded: string, name: string): string {
  const out = baseExpanded + name
  if (typedValue.startsWith("~")) {
    return tildify(out)
  }
  return out
}
