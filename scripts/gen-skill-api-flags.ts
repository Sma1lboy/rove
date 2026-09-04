#!/usr/bin/env bun
/**
 * Render the flag tables in the agent skill's `references/api-flags.md` from
 * the verb specs the binary itself serves through `rove api schema`.
 *
 * The second layer of the skill (SKILL.md → this reference → `schema`) used to
 * be a hand-written table, and it drifted: `routine-create --persistent-session`
 * and `routine-runs`' `revived`/`deferred` statuses shipped for weeks with the
 * reference listing none of them, so an agent reading the skill concluded
 * routines can only spawn a task per run. Layering does not fix that; deriving
 * does.
 *
 * Only the fenced blocks between `<!-- generated:begin <groups> -->` and
 * `<!-- generated:end -->` are owned here — the prose around them stays
 * authored, because "what `--precheck` is FOR" is not in any spec. Each
 * marker names the {@link VerbGroup} ids that section covers, so the
 * section↔group mapping lives in the document instead of in a second table
 * here that could disagree with it.
 *
 *   bun scripts/gen-skill-api-flags.ts            # rewrite both skill copies
 *   bun scripts/gen-skill-api-flags.ts --check    # exit 1 if stale (CI/test)
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FlagSpec, VerbGroup, VerbSpec } from "../packages/kobe/src/cli/api/types.ts"
import { VERB_GROUP_IDS } from "../packages/kobe/src/cli/api/types.ts"
import { VERBS } from "../packages/kobe/src/cli/api/verbs.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** Canonical skill first; every other path is a byte copy of it. */
export const REFERENCE_PATHS = [
  join(ROOT, ".agents/skills/kobe/references/api-flags.md"),
  join(ROOT, "claude-plugin/skills/rove/references/api-flags.md"),
]

/** The command a stale check tells the reader to run. */
const FIX_COMMAND = "bun scripts/gen-skill-api-flags.ts"

const BEGIN = /^<!-- generated:begin (.+?) -->$/
const END = "<!-- generated:end -->"

/** Where a wrapped flag list resumes, and the column budget it wraps at. */
const WRAP_COLS = 90

/**
 * Flag pairs that are ONE choice, not two flags. `--prompt` is marked required
 * on the spec but `--prompt-file` satisfies it, so rendering them as separate
 * tokens would tell an agent to pass both. This is the only such pair on the
 * surface; a second one belongs here rather than in a general rule, because
 * nothing in `FlagSpec` distinguishes "alternate" from "also allowed".
 */
const ALTERNATES: ReadonlyArray<readonly [string, string]> = [["prompt", "prompt-file"]]

/**
 * `--name{a|b}(REQ)` / `--name(default)` / `--name <a,b,c>` — the reference's
 * notation. Metavar placeholders (PATH, ID, TEXT…) are dropped: the flag name
 * already says what they say, and printing them on all ~90 flags is the noise
 * the hand-written table was avoiding. A placeholder that carries SYNTAX
 * rather than a type — it contains a separator, e.g. `claude:2,codex:1` —
 * survives, because that shape is not guessable from the name.
 */
function renderFlag(f: FlagSpec): string {
  const values = f.type === "enum" && f.values ? `{${f.values.join("|")}}` : ""
  const marker = f.required ? "(REQ)" : f.default !== undefined ? `(${f.default})` : ""
  const shape = f.placeholder && /[,:]/.test(f.placeholder) ? ` <${f.placeholder}>` : ""
  return `--${f.name}${values}${marker}${shape}`
}

function renderFlags(verb: VerbSpec): string[] {
  const byName = new Map(verb.flags.map((f) => [f.name, f]))
  const fused = new Map<string, string>()
  const dropped = new Set<string>()
  for (const [primary, secondary] of ALTERNATES) {
    const a = byName.get(primary)
    if (!a || !byName.has(secondary)) continue
    fused.set(primary, `--${primary}|--${secondary}${a.required ? "(REQ)" : ""}`)
    dropped.add(secondary)
  }
  return verb.flags.filter((f) => !dropped.has(f.name)).map((f) => fused.get(f.name) ?? renderFlag(f))
}

/** One `verb  flags…` line, wrapped at {@link WRAP_COLS} with continuations
 *  indented to the flag column so a long verb still reads as one row. */
function renderVerb(verb: VerbSpec, column: number): string[] {
  const tokens = renderFlags(verb)
  if (tokens.length === 0) return [verb.name.padEnd(column) + "(none)"]
  const indent = " ".repeat(column)
  const lines: string[] = []
  let current = verb.name.padEnd(column)
  let started = false
  for (const token of tokens) {
    if (started && current.length + 1 + token.length > WRAP_COLS) {
      lines.push(current)
      current = indent + token
    } else {
      current = started ? `${current} ${token}` : current + token
    }
    started = true
  }
  lines.push(current)
  return lines
}

/** The fenced block for one section — every verb in the named groups, in the
 *  canonical {@link VERBS} order so this listing agrees with `schema`'s. */
export function renderGroups(groups: readonly VerbGroup[]): string {
  const verbs = VERBS.filter((v) => groups.includes(v.group))
  if (verbs.length === 0) throw new Error(`no verbs in group(s): ${groups.join(", ")}`)
  const column = Math.max(...verbs.map((v) => v.name.length)) + 2
  const body = verbs.flatMap((v) => renderVerb(v, column))
  return ["```text", ...body, "```"].join("\n")
}

function parseGroups(raw: string): VerbGroup[] {
  return raw.split(",").map((part) => {
    const id = part.trim()
    if (!(VERB_GROUP_IDS as readonly string[]).includes(id)) {
      throw new Error(`unknown verb group "${id}" in a generated:begin marker`)
    }
    return id as VerbGroup
  })
}

/**
 * group id → the section that documents it, named the way SKILL.md's signpost
 * table cites it: the `## ` heading with any parenthetical stripped, so
 * `## issues (daemon-owned)` is cited as `issues`. Derived from the same
 * markers the blocks are, which is what lets a test assert that every group
 * the binary serves has a row an agent can find it by.
 */
export function sectionsByGroup(source: string): Map<VerbGroup, string> {
  const map = new Map<VerbGroup, string>()
  let heading = ""
  for (const line of source.split("\n")) {
    if (line.startsWith("## ")) heading = line.slice(3).replace(/\s*\(.*$/, "").trim()
    const match = BEGIN.exec(line)
    if (match) for (const group of parseGroups(match[1])) map.set(group, heading)
  }
  return map
}

/** One drifted region, described the way a reader needs to act on it. */
export interface StaleRegion {
  /** The marker's group list, e.g. `create,edit,lifecycle`. */
  readonly groups: string
  /** Lines the file has that the specs do not — usually a renamed verb. */
  readonly stray: string[]
  /** Lines the specs have that the file does not — the missing flags. */
  readonly missing: string[]
}

/** Human-readable: names the group AND the verb lines that moved. */
export function describeStale(regions: readonly StaleRegion[]): string {
  return regions
    .map((r) => [`[${r.groups}]`, ...r.stray.map((l) => `  - ${l}`), ...r.missing.map((l) => `  + ${l}`)].join("\n"))
    .join("\n")
}

export interface RegenResult {
  readonly text: string
  /** Regions whose block changed, for the stale message. */
  readonly stale: StaleRegion[]
  /** Every group id claimed by a marker, so callers can assert coverage. */
  readonly covered: VerbGroup[]
}

/** Replace each generated region in place; everything else survives byte-for-byte. */
export function regenerate(source: string): RegenResult {
  const lines = source.split("\n")
  const out: string[] = []
  const stale: StaleRegion[] = []
  const covered: VerbGroup[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = BEGIN.exec(lines[i])
    if (!match) {
      out.push(lines[i])
      continue
    }
    const raw = match[1]
    const groups = parseGroups(raw)
    covered.push(...groups)
    const close = lines.indexOf(END, i + 1)
    if (close === -1) throw new Error(`unclosed generated region "${raw}"`)
    const fresh = renderGroups(groups)
    const had = lines.slice(i + 1, close)
    const want = fresh.split("\n")
    if (had.join("\n") !== fresh) {
      stale.push({
        groups: raw,
        stray: had.filter((l) => !want.includes(l)),
        missing: want.filter((l) => !had.includes(l)),
      })
    }
    out.push(lines[i], ...fresh.split("\n"), END)
    i = close
  }
  return { text: out.join("\n"), stale, covered }
}

function main(): void {
  const check = process.argv.includes("--check")
  const canonical = readFileSync(REFERENCE_PATHS[0], "utf8")
  const { text, stale, covered } = regenerate(canonical)

  const missing = VERB_GROUP_IDS.filter((g) => !covered.includes(g))
  if (missing.length > 0) {
    console.error(`api-flags.md has no section for verb group(s): ${missing.join(", ")}`)
    console.error(`Add a "## <section>" with a <!-- generated:begin ${missing[0]} --> region.`)
    process.exit(1)
  }

  const drifted = REFERENCE_PATHS.filter((p) => readFileSync(p, "utf8") !== text)
  if (check) {
    if (stale.length > 0) {
      console.error(`api-flags.md no longer matches the verb specs:\n${describeStale(stale)}`)
      console.error(`Regenerate with: ${FIX_COMMAND}`)
      process.exit(1)
    }
    if (drifted.length > 1) {
      console.error(`skill copies disagree: ${drifted.join(", ")}\nRegenerate with: ${FIX_COMMAND}`)
      process.exit(1)
    }
    console.log("api-flags.md is up to date")
    return
  }

  for (const path of REFERENCE_PATHS) writeFileSync(path, text)
  console.log(stale.length > 0 ? `regenerated:\n${describeStale(stale)}` : "no changes")
}

if (import.meta.main) main()
