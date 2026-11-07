/**
 * The app's own log file, plus a once-a-minute memory line for every process it owns (main, renderer, GPU,
 * utilities, the bridge child). A Finder launch has no terminal, and a leak is only diagnosable from a
 * record that was already being kept when it happened.
 *
 * Numbers are what the OS charges the process with: on macOS the footprint (`top`'s MEM, compressed and
 * swapped pages included — RSS hides exactly what a leak pushes out), on Linux VmRSS + VmSwap, elsewhere
 * Electron's working set.
 */

import { spawnSync } from "node:child_process"
import { appendFileSync, readFileSync, renameSync, statSync } from "node:fs"
import { app } from "electron"

const MAX_BYTES = 5 * 1024 * 1024
const EVERY_MS = 60_000
/** One process past this gets its own line, easy to grep for after the fact. */
const WARN_MB = 2048

let file: string | null = null
let size = 0

export function openLog(path: string): void {
  file = path
  try {
    size = statSync(path).size
  } catch {
    size = 0
  }
}

/** Append one timestamped line; past 5 MB the file moves to `.1` (one generation kept). */
export function writeLog(line: string): void {
  if (!file) return
  const text = `${new Date().toISOString()} ${line}\n`
  try {
    if (size + text.length > MAX_BYTES) {
      renameSync(file, `${file}.1`)
      size = 0
    }
    appendFileSync(file, text, "utf8")
    size += text.length
  } catch {
    // A full disk or a removed directory must not take the app down.
  }
}

/** Start the per-minute memory line; `bridgePid` is read each time, since the bridge can be restarted. */
export function watchMemory(bridgePid: () => number | undefined): () => void {
  const sample = () => {
    const procs = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      kind: m.type === "Browser" ? "main" : m.type.toLowerCase(),
      fallbackMb: Math.round(m.memory.workingSetSize / 1024),
    }))
    const bridge = bridgePid()
    if (bridge) procs.push({ pid: bridge, kind: "bridge", fallbackMb: 0 })
    const charged = chargedMb(procs.map((p) => p.pid))
    let total = 0
    const parts: string[] = []
    for (const p of procs) {
      const mb = charged.get(p.pid) ?? p.fallbackMb
      total += mb
      parts.push(`${p.kind}(${p.pid})=${mb}`)
      if (mb > WARN_MB) writeLog(`WARN ${p.kind}(${p.pid}) at ${mb} MB`)
    }
    writeLog(`mem total=${total}MB ${parts.join(" ")}`)
  }
  sample()
  const timer = setInterval(sample, EVERY_MS)
  timer.unref()
  return () => clearInterval(timer)
}

function chargedMb(pids: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (process.platform === "darwin") {
    const args = ["-l", "1", "-stats", "pid,mem", ...pids.flatMap((pid) => ["-pid", String(pid)])]
    const top = spawnSync("top", args, { encoding: "utf8", timeout: 10_000 })
    for (const line of (top.stdout ?? "").split("\n")) {
      const m = /^\s*(\d+)\s+([\d.]+)([BKMG])[+-]?\s*$/.exec(line)
      if (!m) continue
      const n = Number(m[2])
      const mb = m[3] === "G" ? n * 1024 : m[3] === "M" ? n : m[3] === "K" ? n / 1024 : n / 1048576
      out.set(Number(m[1]), Math.round(mb))
    }
  } else if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, "utf8")
        const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(status)?.[1] ?? 0)
        out.set(pid, Math.round((kb("VmRSS") + kb("VmSwap")) / 1024))
      } catch {
        // Gone between listing and reading.
      }
    }
  }
  return out
}
