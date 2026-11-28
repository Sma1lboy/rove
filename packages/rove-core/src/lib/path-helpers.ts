/**
 * Partial-path → suggestion helpers for the new-task dialog's browse picker
 * and `quick-task`. Synchronous fs only (readdir/stat on one directory, per
 * keystroke), never a subprocess — shelling out belongs in `./git-snapshot.ts`
 * (sync, whitelisted) or an async spawn helper.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathSyntax } from "@sma1lboy/rove-daemon/path-identity"
import { tildify } from "./path-home"

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

/** True when `dir` exists on disk and resolves to a directory (follows symlinks/junctions). */
export function isExistingDir(dir: string): boolean {
  if (!dir) return false
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * Direct subdirectories of `base` (including symlinks/junctions to directories), sorted;
 * [] on any fs error so the picker degrades to free text. Hidden entries are kept — `filterSubdirs` hides them.
 */
export function listSubdirs(base: string): readonly string[] {
  if (!base) return []
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.isDirectory() || (e.isSymbolicLink() && isExistingDir(path.join(base, e.name)))) out.push(e.name)
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

/** Input value after drilling into `name`; keeps a typed `~/` prefix and Windows backslash syntax. */
export function joinDrill(typedValue: string, baseExpanded: string, name: string): string {
  const sep = pathSyntax(baseExpanded).sep === "\\" && !typedValue.includes("/") ? "\\" : "/"
  const out = `${baseExpanded + name}${sep}`
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

/** True when `dir` contains a `.git` entry (folder or worktree link file). */
export function isGitDir(dir: string): boolean {
  if (!dir) return false
  try {
    return fs.existsSync(path.join(dir, ".git"))
  } catch {
    return false
  }
}

/** Parent directory with a trailing separator; root stays root (`/` or `C:\`). */
export function parentDir(dir: string): string {
  const syn = pathSyntax(dir)
  const sep = syn.sep
  const clean = stripTrailingSlash(dir)
  const root = syn.parse(clean).root
  if (!clean || clean === root) return root || sep
  const parent = syn.dirname(clean)
  if (parent === root) return root
  return parent.endsWith(sep) ? parent : `${parent}${sep}`
}

/** Strip matching single or double quotes around a pasted filepath (e.g. Finder / Explorer "Copy as path"). */
export function stripPathQuotes(value: string): string {
  const t = value.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return value
}

/**
 * Normalize a clipboard-pasted path across Windows, Linux, and macOS:
 *   - strips matching single/double quotes (Explorer "Copy as path", shell quotes)
 *   - decodes `file://` URIs (Linux Nautilus/Dolphin/Thunar, Windows `file:///C:/…`, UNC `file://host/share`)
 *   - strips Windows extended-length prefixes (`\\?\C:\…`, `\\?\UNC\…`)
 *   - unescapes shell-escaped spaces (`\ `) on POSIX paths without touching Windows backslashes
 */
export function normalizePastedPath(value: string): string {
  let out = stripPathQuotes(value).trim()
  if (!out) return value
  if (/^file:\/\//i.test(out)) {
    const withoutScheme = out.slice("file://".length)
    let decoded = withoutScheme
    try {
      decoded = decodeURIComponent(withoutScheme)
    } catch {
      // Malformed percent-escape: keep the raw text rather than failing the keystroke.
    }
    if (/^localhost\//i.test(decoded)) {
      decoded = decoded.slice("localhost".length)
    } else if (!decoded.startsWith("/")) {
      // `file://server/share/path` → Windows UNC `\\server\share\path`
      return `\\\\${decoded.replaceAll("/", "\\")}`
    }
    // `file:///C:/Projects/demo` → `C:/Projects/demo`
    out = /^\/[a-z]:[/\\]/i.test(decoded) ? decoded.slice(1) : decoded
  }
  if (/^\\\\\?\\UNC\\/i.test(out)) {
    out = `\\\\${out.slice("\\\\?\\UNC\\".length)}`
  } else if (/^\\\\\?\\[a-z]:[/\\]/i.test(out)) {
    out = out.slice("\\\\?\\".length)
  }
  if (pathSyntax(out).sep === "/" && (out.startsWith("/") || out.startsWith("~/")) && out.includes("\\ ")) {
    out = out.replaceAll("\\ ", " ")
  }
  return out
}
