#!/usr/bin/env node
// The owner's PR gate, from the same scripts CI runs. The default tier is
// fast (gates, typecheck, touched packages' tests: well under a minute);
// the full suite runs on main's scheduled batch, before every release, and
// on other people's PRs (ci.yml). `--full` runs that suite here instead.
//
// Usage:
//   bun run pre-pr -- --body-file pr.md   # the same file you give `gh pr create`
//   bun run pre-pr -- --full              # every suite, in a parallel pool
//   bun run pre-pr -- --quick             # the few-second subset (pre-push hook)
//   options: --base <branch> (default main), --no-fetch, --jobs <n> (default: half the cores),
//            --no-wsl (Windows: run the POSIX suites natively instead of in WSL)

import { spawn, spawnSync } from "node:child_process"
import { createWriteStream, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validateUiEvidence } from "./ui-evidence.mjs"
import { wslDistro, wslScript } from "./pre-pr-wsl.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

// Their suites have dedicated steps below rather than their `test` script.
const DEDICATED = new Set(["@sma1lboy/rove", "rove-harness"])
// CI ran these on every PR whatever the diff touched.
const ALWAYS = ["rove-bridge", "rove-weixin"]

/** Mirrors the old changeset-cap job: published-package source needs an added changeset. */
export function missingChangeset(changedFiles, addedFiles) {
  const userFacing = changedFiles.some((f) => /^packages\/(rove|rove-daemon)\/src\//.test(f))
  const added = addedFiles.some((f) => /^\.changeset\/[^/]+\.md$/.test(f) && !f.endsWith("README.md"))
  return userFacing && !added
}

/**
 * Package `test` scripts to run: the always-run ones plus every touched
 * package with a `test` script. `manifests` maps `packages/<dir>` to package.json.
 */
export function packagesToTest(files, manifests) {
  const dirs = new Set(files.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean))
  const names = new Set(ALWAYS)
  for (const dir of dirs) {
    const pkg = manifests[dir]
    if (pkg?.name && pkg.scripts?.test && !DEDICATED.has(pkg.name)) names.add(pkg.name)
  }
  return [...names].sort()
}

/** Path-filtered suites, matching the `paths` filters of their workflows. */
export function touchedAreas(files) {
  const any = (re) => files.some((f) => re.test(f))
  return {
    docs: any(/^(docs\/|packages\/rove-docs\/|\.github\/workflows\/docs-site\.yml$)/),
    ios: any(/^(packages\/rove-ios\/|\.github\/workflows\/ios\.yml$)/),
    pluginWindows: any(
      /^(packages\/rove-daemon\/src\/plugins\/|packages\/rove-daemon\/src\/client\/detached-spawn\.ts$|packages\/rove\/test\/behavior\/plugin-process\/|packages\/rove-harness\/e2e\/plugin-windows|\.github\/workflows\/plugin-windows\.yml$)/,
    ),
  }
}

function parseArgs(argv) {
  const opts = { base: "main", bodyFile: null, quick: false, full: false, fetch: true, jobs: Math.max(4, Math.floor(availableParallelism() / 2)), wsl: true, suitesOnly: false, touchedFile: null }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s)
    const value = () => inline ?? argv[++i]
    if (flag === "--quick") opts.quick = true
    else if (flag === "--full") opts.full = true
    else if (flag === "--no-fetch") opts.fetch = false
    else if (flag === "--no-wsl") opts.wsl = false
    else if (flag === "--suites-only") opts.suitesOnly = true
    else if (flag === "--touched-file") opts.touchedFile = value()
    else if (flag === "--base") opts.base = value()
    else if (flag === "--body-file") opts.bodyFile = value()
    else if (flag === "--jobs") opts.jobs = Math.max(1, Number(value()) || 1)
    else throw new Error(`unknown argument: ${argv[i]}`)
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
let LOGS

function record(name, ok, start, log) {
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  results.push({ name, ok, secs, log })
  process.stdout.write(`${ok ? "✓" : "✗"} ${name} (${secs}s)\n`)
  return ok
}

/** Inline step: output streams to the terminal. */
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
  return record(name, ok, start)
}

function run(cmd, args, env, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.error) throw r.error
  return r.status === 0
}

/** Pooled job: a list of commands run in order, output to a log file. */
function job(name, commands) {
  return async () => {
    const start = Date.now()
    const log = join(LOGS, `${name.replace(/[^\w.-]+/g, "_")}.log`)
    const out = createWriteStream(log)
    let ok = true
    for (const { cmd, args, cwd = ROOT, env } of commands) {
      out.write(`$ ${cmd} ${args.join(" ")}\n`)
      ok = await new Promise((done) => {
        const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } })
        child.stdout.pipe(out, { end: false })
        child.stderr.pipe(out, { end: false })
        child.on("error", (err) => {
          out.write(`${err.message}\n`)
          done(false)
        })
        child.on("close", (code) => done(code === 0))
      })
      if (!ok) break
    }
    out.end()
    return record(name, ok, start, log)
  }
}

async function pool(jobs, size) {
  const queue = [...jobs]
  const worker = async () => {
    while (queue.length) await queue.shift()()
  }
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, worker))
}

const ROVE = join(ROOT, "packages", "rove")
const HARNESS = join(ROOT, "packages", "rove-harness")
const bun = (args, cwd, env) => ({ cmd: "bun", args, cwd, env })

const harnessJob = (tests) => job("harness PTY lifecycle", [bun(["run", "test", ...tests], HARNESS)])
const WINDOWS_HARNESS = ["test/pty-session-lifecycle.test.ts", "test/pty-sidecar-shutdown.test.mjs"]

function heavyJobs(touched) {
  const areas = touchedAreas(touched)
  const harnessTests =
    process.platform === "win32"
      ? WINDOWS_HARNESS
      : ["test/pty-session-lifecycle.test.ts", "test/pty-tree-lifecycle.test.mjs", "test/pty-sidecar-shutdown.test.mjs"]
  // On Linux, macOS's ratchet list is known to fail; macOS runs everything.
  const renderArgs = process.platform === "linux" ? ["--platform=linux"] : []
  // The render track is the long pole serially (~3.5 min); shard it as CI does.
  const renderShards = [1, 2, 3, 4].map((i) =>
    job(`render track ${i}/4`, [bun(["scripts/render-track.mjs", ...renderArgs, "--half=main", `--shard=${i}/4`], ROVE)]),
  )
  const jobs = [
    ...renderShards,
    job("render track PTY half", [bun(["scripts/render-track.mjs", ...renderArgs, "--half=pty"], ROVE)]),
    job("rove unit tests", [bun(["x", "vitest", "run", "--passWithNoTests", "--minWorkers=1", "--maxWorkers=8"], ROVE)]),
    // Serial within a shard, as test:behavior is; each file isolates its own ROVE_HOME, so shards can overlap.
    ...[1, 2, 3].map((i) =>
      job(`behavior ${i}/3`, [
        bun(["x", "vitest", "run", "test/behavior", "--pool", "forks", "--minWorkers=1", "--maxWorkers=1", "--retry=2", "--passWithNoTests", `--shard=${i}/3`], ROVE, {
          ROVE_INCLUDE_BEHAVIOR: "1",
        }),
      ]),
    ),
    harnessJob(harnessTests),
    job("visual ground truth", [bun(["x", "playwright", "install", "chromium"], HARNESS), bun(["run", "visual"], HARNESS)]),
    job("built CLI carries weixin", [bun(["packages/rove/dist/cli/rove.js", "weixin", "--help"])]),
    ...packagesToTest(touched, readManifests()).map((name) => job(`${name} tests`, [bun(["--filter", name, "test"])])),
  ]
  if (areas.docs) jobs.push(job("docs site build", [bun(["run", "--filter", "@sma1lboy/rove-docs", "build"])]))
  if (areas.ios) jobs.push(job("iOS color guard", [{ cmd: bashPath(), args: ["scripts/lint-colors.sh"], cwd: join(ROOT, "packages", "rove-ios") }]))
  return jobs
}

/** The fast tier's suites: the package tests the diff calls for, and the docs build. */
function fastJobs(touched) {
  const jobs = packagesToTest(touched, readManifests()).map((name) => job(`${name} tests`, [bun(["--filter", name, "test"])]))
  if (touchedAreas(touched).docs) jobs.push(job("docs site build", [bun(["run", "--filter", "@sma1lboy/rove-docs", "build"])]))
  return jobs
}

/**
 * It swaps daemon plugin sources to a baseline and back, so nothing else on
 * this checkout may run beside it (WSL has its own copy), and it rewrites the
 * tracked `plugin-evidence/`, which is put back unless it was already edited.
 */
async function pluginWindowsAcceptance() {
  const evidenceClean = git(["status", "--porcelain", "--", "plugin-evidence"]).length === 0
  await job("plugin-windows acceptance", [
    bun(["packages/rove/test/behavior/plugin-process/compare.mjs"], ROOT, { BASE_SHA: "61c4532cc642039ce4ce3f6739d1ee35f2c58cd0" }),
  ])()
  if (evidenceClean) git(["checkout", "--", "plugin-evidence"])
}

/** Windows: the tier's POSIX suites in WSL, against a copy of HEAD. */
function wslJob(touched, distro, jobs, full) {
  const name = basename(ROOT.replace(/[\\/]+$/, ""))
  const ref = `refs/pre-pr/${name}`
  const touchedFile = join(LOGS, "touched.txt")
  writeFileSync(touchedFile, touched.join("\n"))
  const gitDir = resolve(ROOT, git(["rev-parse", "--git-common-dir"])[0])
  git(["update-ref", ref, "HEAD"])
  const script = wslScript({ name, gitDir, ref, touchedFile, jobs, full })
  return job(`WSL ${distro}: POSIX suites`, [{ cmd: "wsl.exe", args: ["-d", distro, "-e", "bash", "-lc", script] }])
}

function skippedNotes(touched) {
  const areas = touchedAreas(touched)
  const notes = []
  if (process.platform === "win32" || spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0)
    notes.push("clean-linux-install: needs docker on Linux/macOS; runs on push to main")
  if (areas.ios) notes.push("iOS simulator suite: run it in Xcode; ios.yml runs it on push to main")
  if (areas.pluginWindows && process.platform !== "win32") notes.push("plugin-windows acceptance: needs Windows; run plugin-windows.yml by hand")
  return notes
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  LOGS = mkdtempSync(join(tmpdir(), "rove-pre-pr-"))
  const range = `origin/${opts.base}...HEAD`
  if (opts.fetch && !opts.suitesOnly) {
    const f = spawnSync("git", ["fetch", "--quiet", "origin", opts.base], { cwd: ROOT, stdio: "inherit" })
    if (f.status !== 0) console.warn(`warning: git fetch origin ${opts.base} failed; diffing against the local ref`)
  }
  if (opts.suitesOnly) {
    // The WSL half: HEAD is a detached copy with no origin, so the host passes the diff.
    const touched = readFileSync(opts.touchedFile, "utf8").split("\n").filter(Boolean)
    if (!opts.full) await pool(fastJobs(touched), opts.jobs)
    else if (step("build", () => run("bun", ["run", "build"]))) await pool(heavyJobs(touched), opts.jobs)
    return finish()
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
    step("file-size-cap", () =>
      run(bashPath(), ["scripts/file-size-check.sh"], { BASE_REF: opts.base, PR_BODY: body ?? "", PR_NUMBER: "", GH_TOKEN: "" }),
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
    step("script tests", () => run("node", ["--test", "scripts/scan-plugins.test.mjs", "scripts/ui-evidence.test.mjs", "scripts/pre-pr.test.mjs"]))
    const distro = process.platform === "win32" && opts.wsl ? wslDistro() : null
    if (process.platform === "win32" && opts.wsl && !distro) console.warn("warning: no WSL distro found; running the POSIX suites natively (many fail on Windows)")
    process.stdout.write(`\n▶ ${opts.full ? "full" : "fast"} tier, suites in parallel (--jobs ${opts.jobs}), logs in ${LOGS}\n`)
    // WSL builds its own copy, so it need not wait for this checkout's typecheck.
    const wsl = distro ? wslJob(touched, distro, opts.jobs, opts.full)() : null
    // Typecheck and build rebuild the plugin SDK's dist, which the suites here read: run them first.
    if (!opts.full) {
      if (await job("typecheck", [bun(["run", "typecheck"])])()) await pool(distro ? [] : fastJobs(touched), opts.jobs)
    } else if ((await job("typecheck", [bun(["run", "typecheck"])])()) && (await job("build", [bun(["run", "build"])])())) {
      await pool(distro ? [harnessJob(WINDOWS_HARNESS)] : heavyJobs(touched), opts.jobs)
      if (touchedAreas(touched).pluginWindows && process.platform === "win32") await pluginWindowsAcceptance()
    }
    await wsl
    if (opts.full) for (const note of skippedNotes(touched)) console.log(`skip ${note}`)
    else console.log("fast tier: unit, render, behavior, visual and the cross-OS suites run on main's batch and before release (--full runs them here)")
  }
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  for (const r of failed.filter((r) => r.log)) {
    const lines = readFileSync(r.log, "utf8").trimEnd().split("\n")
    console.log(`\n── ${r.name} (last 60 lines of ${r.log}) ──\n${lines.slice(-60).join("\n")}`)
  }
  console.log(`\npre-pr: ${results.length - failed.length}/${results.length} passed`)
  for (const r of failed) console.log(`  ✗ ${r.name}`)
  process.exit(failed.length ? 1 : 0)
}

const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p))
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) await main()
