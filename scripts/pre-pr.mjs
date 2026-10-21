#!/usr/bin/env node
// Local pre-PR gate: CI's fast, deterministic checks, run before `gh pr create`
// so a failure costs seconds instead of a push-fail-fix round trip. It reuses
// the scripts CI runs. CI stays the enforcement boundary; the cross-OS and
// sharded suites (unit shards, behavior, render-track, visual-ground-truth,
// clean-linux-install, harness-windows-lifetime) are not mirrored here.
//
// Usage:
//   bun run pre-pr -- --body-file pr.md   # the same file you give `gh pr create`
//   bun run pre-pr -- --quick             # the sub-10s subset (pre-push hook)
//   options: --base <branch> (default main), --no-fetch

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validateUiEvidence } from "./ui-evidence.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

// Packages whose suites CI runs sharded or on another OS: serial on a laptop
// they are slower than the whole CI run.
export const CI_ONLY_PACKAGES = new Map([
  ["@sma1lboy/rove", "unit-tests x4 + render-track run it in CI"],
  ["rove-harness", "visual-ground-truth runs it in CI"],
])

/** Mirrors ci.yml's changeset-cap: published-package source needs an added changeset. */
export function missingChangeset(changedFiles, addedFiles) {
  const userFacing = changedFiles.some((f) => /^packages\/(rove|rove-daemon)\/src\//.test(f))
  const added = addedFiles.some((f) => /^\.changeset\/[^/]+\.md$/.test(f) && !f.endsWith("README.md"))
  return userFacing && !added
}

/**
 * Workspace packages the diff touches that have a `test` script and are not
 * CI-only. `manifests` maps a `packages/<dir>` name to its package.json.
 */
export function packagesToTest(files, manifests) {
  const dirs = new Set(files.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean))
  const run = []
  const skipped = []
  for (const dir of [...dirs].sort()) {
    const pkg = manifests[dir]
    if (!pkg?.name || !pkg.scripts?.test) continue
    if (CI_ONLY_PACKAGES.has(pkg.name)) skipped.push(pkg.name)
    else run.push(pkg.name)
  }
  return { run, skipped }
}

function parseArgs(argv) {
  const opts = { base: "main", bodyFile: null, quick: false, fetch: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--quick") opts.quick = true
    else if (a === "--no-fetch") opts.fetch = false
    else if (a === "--base") opts.base = argv[++i]
    else if (a === "--body-file") opts.bodyFile = argv[++i]
    else if (a.startsWith("--base=")) opts.base = a.slice(7)
    else if (a.startsWith("--body-file=")) opts.bodyFile = a.slice(12)
    else throw new Error(`unknown argument: ${a}`)
  }
  return opts
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`)
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

// On Windows a bare `bash` can resolve to WSL's System32 shim; use Git's own.
function bashPath() {
  if (process.platform !== "win32") return "bash"
  const execPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim()
  const candidate = join(dirname(dirname(dirname(execPath))), "bin", "bash.exe")
  return existsSync(candidate) ? candidate : "bash"
}

function readManifests() {
  const out = {}
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const file = join(ROOT, "packages", dir, "package.json")
    if (existsSync(file)) out[dir] = JSON.parse(readFileSync(file, "utf8"))
  }
  return out
}

const results = []

function step(name, fn) {
  const start = Date.now()
  process.stdout.write(`\n▶ ${name}\n`)
  let ok
  try {
    ok = fn() !== false
  } catch (err) {
    console.error(String(err?.message ?? err))
    ok = false
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  results.push({ name, ok, secs })
  process.stdout.write(`${ok ? "✓" : "✗"} ${name} (${secs}s)\n`)
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.error) throw r.error
  return r.status === 0
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const range = `origin/${opts.base}...HEAD`
  if (opts.fetch) {
    const f = spawnSync("git", ["fetch", "--quiet", "origin", opts.base], { cwd: ROOT, stdio: "inherit" })
    if (f.status !== 0) console.warn(`warning: git fetch origin ${opts.base} failed; diffing against the local ref`)
  }
  const changed = git(["diff", "--name-only", "--diff-filter=ACMR", range])
  const added = git(["diff", "--name-only", "--diff-filter=A", range])
  const touched = git(["diff", "--name-only", range])
  const body = opts.bodyFile ? readFileSync(opts.bodyFile, "utf8") : null
  if (git(["status", "--porcelain"]).length) console.warn("warning: uncommitted changes are outside the diff the gates check (commit first)")

  step("changeset-cap", () => {
    if (!missingChangeset(changed, added)) return true
    console.error("This branch touches packages/rove/src or packages/rove-daemon/src but adds no .changeset/*.md. Run 'bun run changeset' (or 'bun run changeset -- --empty' for tooling-only).")
    return false
  })
  step("changeset frontmatter", () => run("bun", ["scripts/check-changeset.mjs"]))
  step("lint", () => run("bun", ["run", "lint"]))
  step("no silent catch", () => run("node", ["scripts/no-silent-catch.mjs"]))

  if (!opts.quick) {
    // The CI job reads the live PR body via the API; locally the body file stands in.
    step("file-size-cap", () =>
      run(bashPath(), ["scripts/file-size-check.sh"], {
        BASE_REF: opts.base,
        PR_BODY: body ?? "",
        PR_NUMBER: "",
        GH_TOKEN: "",
      }),
    )
    step("ui-evidence", () => {
      if (body === null) {
        if (validateUiEvidence(touched, "").length === 0) return true
        console.error("UI source changed: pass --body-file <the PR body you will give gh pr create>.")
        return false
      }
      const errors = validateUiEvidence(touched, body)
      for (const e of errors) console.error(e)
      return errors.length === 0
    })
    step("script tests", () => run("node", ["--test", "scripts/scan-plugins.test.mjs", "scripts/pre-pr.test.mjs"]))
    step("typecheck", () => run("bun", ["run", "typecheck"]))
    const { run: pkgs, skipped } = packagesToTest(touched, readManifests())
    for (const name of skipped) console.log(`\nskip ${name} tests: ${CI_ONLY_PACKAGES.get(name)}`)
    for (const name of pkgs) step(`${name} tests`, () => run("bun", ["--filter", name, "test"]))
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\npre-pr: ${results.length - failed.length}/${results.length} passed`)
  for (const r of failed) console.log(`  ✗ ${r.name}`)
  process.exit(failed.length ? 1 : 0)
}

const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p))
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) main()
