/** Pure path/text helpers for the new-task dialog; the TUI's `new-task-dialog/*` rules, minus node:fs. */

/** Base/dir halves of a saved repo path: the basename identifies, the muted dir locates. */
export function splitRepoRow(path: string): { base: string; dir: string } {
  const at = path.lastIndexOf("/")
  if (at < 0 || at === path.length - 1) return { base: path, dir: "" }
  return { base: path.slice(at + 1), dir: path.slice(0, at + 1) }
}

/** Case-insensitive substring filter; an empty query keeps everything. */
export function filterText(all: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase()
  return q ? all.filter((item) => item.toLowerCase().includes(q)) : all
}

/** A value that names a place rather than searches the saved list. */
export function isPathInput(value: string): boolean {
  return value.startsWith("~") || value.includes("/")
}

export function expandTilde(value: string, home: string): string {
  if (!home) return value
  if (value === "~") return home
  return value.startsWith("~/") ? home + value.slice(1) : value
}

export function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

export function tildify(path: string, home: string): string {
  if (!home) return path
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** Input value after SELECTING a subdirectory (no trailing slash: the list collapses). */
export function joinPicked(typed: string, base: string, name: string, home: string): string {
  const out = base + name
  return typed.startsWith("~") ? tildify(out, home) : out
}

/** Input value after DRILLING into a subdirectory (trailing slash: the list shows its children). */
export function joinDrill(typed: string, base: string, name: string, home: string): string {
  return `${joinPicked(typed, base, name, home)}/`
}

export type RepoResolution = { kind: "path"; path: string } | { kind: "ambiguous"; name: string }

/** What the repo field means at submit time: a bare name turns back into the one saved path it names. */
export function resolveRepo(value: string, saved: readonly string[]): RepoResolution {
  const trimmed = value.trim()
  if (!trimmed || isPathInput(trimmed)) return { kind: "path", path: trimmed }
  const matches = saved.filter((path) => splitRepoRow(path).base === trimmed)
  if (matches.length === 1) return { kind: "path", path: matches[0] as string }
  if (matches.length > 1) return { kind: "ambiguous", name: trimmed }
  return { kind: "path", path: trimmed }
}

/** The name when it resolves back to this exact path, else the path (a shared basename identifies nothing). */
export function nameOrPath(path: string, saved: readonly string[]): string {
  const name = splitRepoRow(path).base
  const back = resolveRepo(name, saved)
  return back.kind === "path" && back.path === path ? name : path
}

/** Default clone folder: the last `/`- or `:`-separated URL segment minus `.git`. */
export function deriveFolderName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":"))
  return (cut >= 0 ? trimmed.slice(cut + 1) : trimmed).replace(/\.git$/i, "")
}

/** `*` any run but `/`, `**` any run, `?` one char; matched against the whole path or the basename. */
export function matchPathGlob(glob: string, path: string): boolean {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
      } else re += "[^/]*"
    } else if (c === "?") re += "[^/]"
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  const rx = new RegExp(`^${re}$`)
  return rx.test(path) || rx.test(path.slice(path.lastIndexOf("/") + 1))
}

/** Glob filter over adoptable worktrees; empty = all. */
export function filterByGlob<T extends { path: string }>(list: readonly T[], glob: string): readonly T[] {
  const pattern = glob.trim()
  return pattern ? list.filter((item) => matchPathGlob(pattern, item.path)) : list
}
