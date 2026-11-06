#!/usr/bin/env node
// Version for the `next` channel: `<next stable version>-next.<N>`.
//
// "Next stable version" is what `changeset version` would produce for
// @sma1lboy/rove from the pending .changeset/*.md (highest bump wins), or
// current+patch when none name it. A prerelease ranks BELOW its release, so
// when that version really ships every `next` build of it is older.
//
//   node scripts/next-version.mjs <N> [--changeset-dir <dir>] [--base <x.y.z>]
//
// Prints the version. Pure: touches nothing, so it dry-runs locally.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const PACKAGE = "@sma1lboy/rove"
const RANK = { patch: 1, minor: 2, major: 3 }

/** Highest bump type the changesets in `files` ({name, text}) ask of `pkg`; null when none do. */
export function pendingBump(files, pkg = PACKAGE) {
  let best = null
  for (const { text } of files) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!fm) continue
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?(patch|minor|major)["']?\s*$/.exec(line)
      if (m && m[1] === pkg && (best === null || RANK[m[2]] > RANK[best])) best = m[2]
    }
  }
  return best
}

export function bumpVersion(base, bump) {
  const [major, minor, patch] = base.split("-")[0].split(".").map(Number)
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function nextVersion(base, files, n) {
  return `${bumpVersion(base, pendingBump(files) ?? "patch")}-next.${n}`
}

function main(argv) {
  const n = argv[0]
  if (!/^\d+$/.test(n ?? "")) {
    console.error("usage: next-version.mjs <N> [--changeset-dir <dir>] [--base <x.y.z>]")
    process.exit(2)
  }
  const opt = (name) => {
    const i = argv.indexOf(name)
    return i === -1 ? undefined : argv[i + 1]
  }
  const dir = opt("--changeset-dir") ?? ".changeset"
  const base = opt("--base") ?? JSON.parse(readFileSync("packages/rove/package.json", "utf8")).version
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }))
  console.log(nextVersion(base, files, n))
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
