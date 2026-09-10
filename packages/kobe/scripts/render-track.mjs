#!/usr/bin/env bun
// The render track, run as TWO `bun test` processes instead of one.
//
// Why: a PTY child can enter a state it does not leave — `?NEs`, surviving
// SIGKILL — and bun's main thread then blocks in a synchronous `wait4()` on
// it. As one process that wedges the WHOLE track: on 2026-09-07 (Release
// 0.9.175) and 2026-09-08 (main CI) the job printed its last `(pass)`, opened
// `test/render/pty-hosted.test.ts` / `pty-host.test.ts`, and emitted nothing
// for ~12m45s until `timeout-minutes: 15` cancelled it. No summary line, no
// coverage — the rest of the suite's results were lost along with it.
//
// Splitting does not stop a child from wedging. It bounds the blast radius:
// the PTY files run LAST in their own process, so the rest have already
// run, reported, and written their coverage before anything can wedge.
//
// Both halves always run — a failure in the first does not skip the second —
// and the exit code is non-zero if either failed. Each writes its own lcov;
// scripts/coverage-gate.mjs unions them per line (the PTY files re-report 142
// sources the main half already covers, so a naive last-record-wins read
// would replace real coverage with the thinner one).

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = "test/render"

/** Every test file under `test/render`, repo-relative, one level of nesting. */
function testFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...testFiles(path))
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(path)
  }
  return found
}

const all = testFiles(ROOT).sort()
// Basename, not path: the marker is the file's own name, so a `pty-*` file
// added under a subdirectory later lands in the bounded half automatically.
const isPty = (path) => /(^|\/)pty-[^/]*\.test\.tsx?$/.test(path)
const pty = all.filter(isPty)
const main = all.filter((path) => !isPty(path))

if (pty.length === 0 || main.length === 0) {
  console.error(`render-track: expected both halves to be non-empty (main=${main.length}, pty=${pty.length})`)
  process.exit(2)
}

/**
 * Wall-clock ceiling on the PTY half. The 7 PTY files take ~15s; three minutes
 * is twelve times that, so this can only fire on a process that has stopped
 * making progress altogether — never on a slow runner.
 *
 * This is NOT `--bail` and NOT the job's `timeout-minutes`. Both of those hide
 * the problem: `--bail` would drop the other files' results, and a bigger job
 * timeout just buys a longer silence. This converts the one failure mode we
 * have actually seen — a blank log cancelled by the runner at 15 minutes, with
 * no summary and no coverage — into a red run three minutes in that says what
 * happened and still carries the other half's results.
 *
 * If this ever fires, it is oven-sh/bun#42171: a PTY child and the runtime
 * deadlock in a synchronous `wait4()`, and no signal to the child clears it.
 * SIGKILL to the bun process does, and takes its stuck children with it.
 */
const PTY_TIMEOUT_MS = 3 * 60_000

/** One `bun test` process over `files`, coverage into its own directory. */
function run(label, files, coverageDir, timeoutMs) {
  console.log(`\n=== render track: ${label} (${files.length} files) → ${coverageDir} ===\n`)
  const result = spawnSync(
    "bun",
    [
      "test",
      ...files,
      "--coverage",
      "--coverage-reporter=text",
      "--coverage-reporter=lcov",
      `--coverage-dir=${coverageDir}`,
    ],
    { stdio: "inherit", timeout: timeoutMs, killSignal: "SIGKILL" },
  )
  if (result.error?.code === "ETIMEDOUT") {
    console.error(
      `
render track: the ${label} half produced no result within ${Math.round(timeoutMs / 1000)}s and was killed.
This is the wedge in oven-sh/bun#42171, not a slow runner: a PTY child and the
bun runtime deadlock in a synchronous wait4(), so the process sits at 0% CPU
forever. Whatever the other half reported above still stands.
`,
    )
    return false
  }
  // A signalled process reports status null; that is a failure, not a pass.
  return result.status === 0 && !result.signal
}

// PTY last, deliberately: whatever it does, the other half has already
// reported by the time it starts.
// The main half is deliberately unbounded: it has never wedged, and a ceiling
// there would be a guess. Only the half that has actually hung gets a clock.
const mainOk = run("main", main, "coverage-render", undefined)
const ptyOk = run("pty", pty, "coverage-render-pty", PTY_TIMEOUT_MS)

if (!mainOk || !ptyOk) {
  console.error(`\nrender track failed (main=${mainOk ? "pass" : "FAIL"}, pty=${ptyOk ? "pass" : "FAIL"})`)
  process.exit(1)
}
