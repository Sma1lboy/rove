/**
 * Live cwd of a process — where a scratch shell "settled", which (plus a
 * detected harness) picks the project group the row migrates into.
 *
 * /proc/<pid>/cwd first, else `lsof -a -p <pid> -d cwd -Fn` (macOS has no
 * /proc). Null on any failure: an unknown cwd is "not settled", never a guess.
 */

import { readlinkSync } from "node:fs"

/** Parse `lsof -Fn` output: the first `n`-prefixed line is the cwd path. */
export function parseLsofCwd(output: string): string | null {
  for (const line of output.split("\n")) {
    if (line.startsWith("n") && line.length > 1) return line.slice(1)
  }
  return null
}

/** Injectable for tests — the real one shells out to lsof. */
export type LsofCwd = (pid: number) => Promise<string>

const lsofCwd: LsofCwd = async (pid) => {
  const proc = Bun.spawn(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  return await new Response(proc.stdout).text()
}

/** The process's current working directory, or null when unreadable. */
export async function processCwd(pid: number, lsof: LsofCwd = lsofCwd): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    /* no /proc (macOS) — fall through to lsof */
  }
  try {
    return parseLsofCwd(await lsof(pid))
  } catch {
    return null
  }
}
