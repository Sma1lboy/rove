/**
 * The shape of a change before reading it: which group each file belongs to, a rule-based review effort (1-5),
 * and the order the diff lists files in. A heuristic, not a verdict: the formula lives here and nowhere else.
 */

import { t } from "./i18n/index.ts"

export type FileGroup = "source" | "tests" | "config" | "docs" | "generated"

export const GROUP_ORDER: readonly FileGroup[] = ["source", "tests", "config", "docs", "generated"]

const LOCKFILES =
  /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|go\.sum|composer\.lock)$/
const GENERATED =
  /(^|\/)(dist|build|generated|__generated__|\.next)\/|\.min\.(js|css)$|\.snap$|\.generated\.|\.pb\.go$|\.map$/
const TESTS = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/
const DOCS = /\.(md|mdx|rst|txt)$|(^|\/)docs\//i
const CONFIG =
  /(^|\/)(\.[\w.-]+rc(\.\w+)?|[\w.-]*\.config\.[cm]?[jt]s|tsconfig[\w.-]*\.json|package\.json|biome\.json|Dockerfile|Makefile)$|\.(ya?ml|toml|ini|env)$|(^|\/)\.(github|changeset|vscode)\//

export const isLockfile = (path: string): boolean => LOCKFILES.test(path)

export function groupOf(path: string): FileGroup {
  if (LOCKFILES.test(path) || GENERATED.test(path)) return "generated"
  if (TESTS.test(path)) return "tests"
  if (DOCS.test(path)) return "docs"
  if (CONFIG.test(path)) return "config"
  return "source"
}

/** Groups a reviewer rarely reads line by line: folded when the diff first opens. */
export const foldedByDefault = (path: string): boolean => groupOf(path) === "generated"

export interface FileSize {
  readonly path: string
  readonly lines: number
}

/** 1 (a glance) to 5 (set time aside), from the files and lines a person must read; generated files and docs don't count. */
export function effort(files: readonly FileSize[]): number {
  const read = files.filter((f) => groupOf(f.path) !== "generated")
  const lines = read.reduce((sum, f) => sum + f.lines, 0)
  const tier = (n: number, l: number) =>
    n <= 2 && l <= 30 ? 1 : n <= 5 && l <= 150 ? 2 : n <= 10 && l <= 400 ? 3 : n <= 20 && l <= 1000 ? 4 : 5
  return read.length === 0 ? 1 : tier(read.length, lines)
}

/** `2 tests · 1 lockfile`-style counts per group, source first, only groups that occur. */
export function groupCounts(paths: readonly string[]): { group: FileGroup | "lockfile"; count: number }[] {
  const out: { group: FileGroup | "lockfile"; count: number }[] = []
  const tally = (group: FileGroup | "lockfile", count: number) => count > 0 && out.push({ group, count })
  for (const group of GROUP_ORDER) {
    if (group === "generated") {
      tally("lockfile", paths.filter(isLockfile).length)
      tally("generated", paths.filter((p) => groupOf(p) === "generated" && !isLockfile(p)).length)
    } else tally(group, paths.filter((p) => groupOf(p) === group).length)
  }
  return out
}

/** A combined diff's rows with whole files moved into group order (source first, generated last); each file stays intact and keeps its own order within a group. */
export function orderByGroup<R extends { kind: string; path: string | null }>(rows: readonly R[]): R[] {
  const files: R[][] = []
  for (const row of rows) {
    if (row.kind === "file" || files.length === 0) files.push([])
    files[files.length - 1]?.push(row)
  }
  const rank = (file: R[]) => GROUP_ORDER.indexOf(groupOf(file[0]?.path ?? ""))
  return files
    .map((file, i) => ({ file, i }))
    .sort((a, b) => rank(a.file) - rank(b.file) || a.i - b.i)
    .flatMap(({ file }) => file)
}

/** `effort 3/5 · 2 tests · 1 lockfile` parts for a toolbar line, as i18n keys with counts. */
export function shapeParts(files: readonly FileSize[]): { key: string; count: number }[] {
  return groupCounts(files.map((f) => f.path)).map(({ group, count }) => ({
    key: group === "lockfile" ? (count === 1 ? "lockfile" : "lockfiles") : group,
    count,
  }))
}

/** The toolbar's line for a combined diff: `effort 3/5 · 2 tests · 1 lockfile`; empty for fewer than two files. */
export function shapeLine(
  stats: ReadonlyMap<number, { added: number; removed: number }>,
  rows: readonly { path: string | null }[],
): string {
  const sizes = [...stats.entries()].flatMap(([i, st]) => {
    const path = rows[i]?.path
    return path ? [{ path, lines: st.added + st.removed }] : []
  })
  if (sizes.length < 2) return ""
  return [
    t("review.shape.effort", { n: effort(sizes) }),
    ...shapeParts(sizes).map((p) => t(`review.shape.${p.key}`, { count: p.count })),
  ].join(" · ")
}
