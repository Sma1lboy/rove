/**
 * rove-bench — how Rove behaves as the number of tasks and branches grows.
 *
 * For each size it seeds a throwaway home (never ~/.rove) with that many tasks, starts the REAL
 * daemon on it, and times the paths a user waits on: daemon start, the first snapshot, reading the
 * list, changing one row, the web bridge's list build, and the CLI. A second pass grows one repo's
 * branch count and times the branch pickers. Numbers are this machine's; compare runs with
 * `--baseline <file>`, not across machines.
 *
 * From packages/rove:  bun run rove-bench [--sizes 100,1000,10000] [--branches 100,1000,10000]
 *                                         [--json <out>] [--baseline <file>]
 */

import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const list = (name: string, fallback: number[]) => arg(name)?.split(",").map(Number).filter(Boolean) ?? fallback
const SIZES = list("sizes", [100, 1000, 10000])
const BRANCHES = list("branches", [100, 1000, 10000])
const PKG = join(import.meta.dir, "..")
const CLI = join(PKG, "src/cli/rove.ts")
// Short on purpose: a unix socket path is capped near 104 bytes.
const ROOT = mkdtempSync("/tmp/rvb-")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const git = (cwd: string, args: string[], input?: string) =>
  execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@rove", ...args], {
    cwd,
    input,
    stdio: ["pipe", "pipe", "ignore"],
  })

type Row = Record<string, number>
const results: Record<string, Row> = {}
const record = (metric: string, size: number, value: number) => {
  results[metric] ??= {}
  results[metric][String(size)] = Math.round(value * 100) / 100
}
async function timed(reps: number, fn: () => unknown): Promise<number> {
  const xs: number[] = []
  for (let i = 0; i < reps; i++) {
    const t = performance.now()
    await fn()
    xs.push(performance.now() - t)
  }
  return median(xs)
}

function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  git(dir, ["init", "-q", "-b", "main"])
  writeFileSync(join(dir, "README.md"), "bench\n")
  git(dir, ["add", "README.md"])
  git(dir, ["commit", "-qm", "init"])
  return dir
}

/** Tasks as a long-lived install holds them: 20 projects, a third archived, some with prompts and PR state. */
async function seed(home: string, n: number): Promise<string[]> {
  const { ulid } = await import("../src/orchestrator/index/ulid.ts")
  const repos = Array.from({ length: 20 }, (_, i) => makeRepo(join(home, "repos", `project-${i}`)))
  const tasks = []
  const t0 = Date.parse("2026-01-01T00:00:00Z")
  for (let i = 0; i < n; i++) {
    const at = new Date(t0 + i * 60_000).toISOString()
    tasks.push({
      id: ulid(t0 + i * 60_000),
      title: `task ${i}: make the thing do the other thing`,
      repo: repos[i % repos.length],
      branch: `feat/task-${i}`,
      worktreePath: "",
      status: i % 5 === 0 ? "in_review" : "backlog",
      pinned: i % 50 === 0,
      kind: "task",
      vendor: "claude",
      createdAt: at,
      updatedAt: at,
      ...(i % 3 === 0 ? { archived: true } : {}),
      ...(i % 4 === 0 ? { prompt: "Please look at the failing case and fix it. ".repeat(6) } : {}),
    })
  }
  mkdirSync(join(home, ".rove"), { recursive: true })
  writeFileSync(join(home, ".rove", "tasks.json"), JSON.stringify({ version: 3, tasks, removed: [] }))
  return repos
}

async function benchTasks(n: number): Promise<void> {
  const home = join(ROOT, `t${n}`)
  await seed(home, n)
  const env = { ...process.env, HOME: home, ROVE_HOME_DIR: home }
  for (const k of ["ROVE_DAEMON_SOCKET_PATH", "ROVE_TASK_ID", "ROVE_TAB_ID"]) delete (env as Record<string, unknown>)[k]
  const sock = join(home, ".rove", "daemon.sock")

  const started = performance.now()
  const daemon = spawn("bun", [CLI, "daemon", "start"], { env, stdio: "ignore" })
  try {
    while (!existsSync(sock)) {
      if (performance.now() - started > 120_000) throw new Error(`daemon did not start with ${n} tasks`)
      await sleep(10)
    }
    record("daemon start → socket (ms)", n, performance.now() - started)

    const { RoveDaemonClient } = await import("@sma1lboy/rove-daemon/client")
    const client = new RoveDaemonClient(sock)
    const t1 = performance.now()
    const first = await client.request<{ tasks: { id: string }[] }>("task.list")
    record("first task.list (ms)", n, performance.now() - t1)
    record("task.list payload (KB)", n, JSON.stringify(first).length / 1024)
    record("task.list p50 (ms)", n, await timed(15, () => client.request("task.list")))
    const id = first.tasks[Math.floor(first.tasks.length / 2)]?.id
    record("task.get p50 (ms)", n, await timed(15, () => client.request("task.get", { taskId: id })))
    let flip = false
    record(
      "task.pin p50, one row changed and saved (ms)",
      n,
      await timed(15, () => {
        flip = !flip
        return client.request("task.pin", { taskId: id, pinned: flip })
      }),
    )
    let name = 0
    record(
      "task.rename p50 (ms)",
      n,
      await timed(15, () => client.request("task.rename", { taskId: id, title: `renamed ${name++}` })),
    )

    // The web bridge's list: what every browser is sent when anything changes.
    const { createRoveOps } = await import("../../rove-bridge/src/rove-ops.ts")
    const ops = createRoveOps(client as never)
    const payload = await ops.tasks()
    record("bridge list build p50 (ms)", n, await timed(7, () => ops.tasks()))
    const json = JSON.stringify(payload)
    record("bridge push payload (KB)", n, json.length / 1024)
    record("bridge change check, stringify (ms)", n, await timed(7, () => JSON.stringify(payload)))
    // The same change as a patch: what a browser that asked for patches is sent instead.
    const { diffPayload, indexPayload } = await import("../../rove-bridge/src/tasks-patch.ts")
    const edited = {
      ...payload,
      tasks: payload.tasks.map((t, i) => (i === 7 ? { ...t, title: "one row changed" } : t)),
    }
    const before = indexPayload(payload)
    const patch = diffPayload(before, indexPayload(edited), edited, 1)
    record("bridge push when one row changed (KB)", n, JSON.stringify(patch).length / 1024)
    record(
      "bridge: find what changed (ms)",
      n,
      await timed(7, () => diffPayload(before, indexPayload(edited), edited, 1)),
    )
    // What each browser does with that push before React draws: parse it, then lay the rail out.
    record("browser: parse the push (ms)", n, await timed(7, () => JSON.parse(json)))
    const { railRows } = await import("../../rove-web/src/rail.ts")
    const rail = () => railRows({ tasks: payload.tasks, remote: [], machines: [], sort: "default", query: "" })
    record("browser: rail rows built (count)", n, rail().rows.length)
    record("browser: build the rail rows (ms)", n, await timed(7, rail))

    const rss = execFileSync("ps", ["-o", "rss=", "-p", String(daemon.pid)])
      .toString()
      .trim()
    record("daemon memory (MB)", n, Number(rss) / 1024)

    record(
      "CLI `rove api list` wall (ms)",
      n,
      await timed(3, () =>
        // The list is megabytes at this size: read it all, as a script piping it would.
        execFileSync("bun", [CLI, "api", "list"], { env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 30 }),
      ),
    )
    client.forceDisconnect?.()
  } finally {
    daemon.kill()
  }
}

async function benchBranches(n: number): Promise<void> {
  const repo = makeRepo(join(ROOT, `b${n}`))
  const head = git(repo, ["rev-parse", "HEAD"]).toString().trim()
  git(
    repo,
    ["update-ref", "--stdin"],
    Array.from({ length: n }, (_, i) => `create refs/heads/feat/b-${i} ${head}\n`).join(""),
  )
  const snap = await import("../src/tui/lib/git-snapshot.ts")
  const asnap = await import("../src/tui/lib/git-snapshot-async.ts")
  record("branches: sync list, blocks its caller (ms)", n, await timed(7, () => snap.listLocalBranches(repo)))
  record("branches: async list (ms)", n, await timed(7, () => asnap.listLocalBranches(repo)))
  record("branches: repo check (ms)", n, await timed(7, () => asnap.validateRepoPath(repo)))
}

for (const n of SIZES) {
  process.stderr.write(`tasks ${n}…\n`)
  await benchTasks(n)
}
for (const n of BRANCHES) {
  process.stderr.write(`branches ${n}…\n`)
  await benchBranches(n)
}

const baselinePath = arg("baseline")
const baseline: Record<string, Row> | null = baselinePath
  ? JSON.parse(readFileSync(baselinePath, "utf8")).results
  : null
const cols = [...new Set(Object.values(results).flatMap((row) => Object.keys(row)))].sort(
  (a, b) => Number(a) - Number(b),
)
const width = Math.max(...Object.keys(results).map((m) => m.length))
console.log(`${"".padEnd(width)}  ${cols.map((c) => c.padStart(12)).join("")}   ×largest/smallest`)
for (const [metric, row] of Object.entries(results)) {
  const mine = cols.filter((c) => row[c] !== undefined)
  const growth =
    mine.length > 1 ? (row[mine.at(-1) as string] as number) / Math.max(row[mine[0] as string] as number, 0.1) : 1
  const cells = cols.map((c) => {
    if (row[c] === undefined) return "".padStart(12)
    const was = baseline?.[metric]?.[c]
    const delta = was ? ` ${row[c] >= was ? "+" : ""}${Math.round(((row[c] as number) / was - 1) * 100)}%` : ""
    return `${row[c]}${delta}`.padStart(12)
  })
  console.log(`${metric.padEnd(width)}  ${cells.join("")}   ×${growth.toFixed(1)}`)
}
const out = arg("json")
if (out)
  writeFileSync(
    out,
    JSON.stringify({ at: new Date().toISOString(), sizes: SIZES, branches: BRANCHES, results }, null, 1),
  )
process.exit(0)
