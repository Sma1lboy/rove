import { randomUUID } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync } from "node:fs"
import { join } from "node:path"
import { preRenameConfigDir, preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"

interface RetirementResult {
  readonly retired: number
  readonly retained: readonly string[]
  readonly warnings: readonly string[]
}

function stat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function hasLiveOwner(pidPath: string): boolean {
  const entry = stat(pidPath)
  if (!entry || entry.isSymbolicLink()) return false
  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim())
    if (!Number.isSafeInteger(pid) || pid <= 1) return true
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

const PTY_ENTRIES = new Set(["pty.sock", "pty.pid", "pty.log", "pty-exits.json", "pty-sessions"])
const ADDRESSES = new Set(["daemon.sock", "daemon.pid", "daemon.log", "pty.sock", "pty.pid", "pty.log"])

/** Retire imported sources without overwriting canonical data or relocating occupied Git worktrees. */
export function retirePreRenameLayout(home: string): RetirementResult {
  const state = preRenameStateDir(home)
  const config = preRenameConfigDir(home)
  const canonical = join(home, ".rove")
  const retained: string[] = []
  const warnings: string[] = []
  let retired = 0
  try {
    const daemonLive = hasLiveOwner(join(state, "daemon.pid"))
    const ptyLive = hasLiveOwner(join(state, "pty.pid"))
    for (const [sourceRoot, targetRoot, group] of [
      [state, canonical, "state"],
      [config, join(home, ".config", "rove"), "config"],
    ]) {
      const rootStat = stat(sourceRoot)
      if (!rootStat) continue
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        retained.push(sourceRoot)
        continue
      }
      for (const name of readdirSync(sourceRoot)) {
        const source = join(sourceRoot, name)
        const entry = stat(source)
        if (!entry) continue
        if (
          daemonLive ||
          (group === "state" && (name === "worktrees" || (ptyLive && PTY_ENTRIES.has(name) && !entry.isSymbolicLink())))
        ) {
          retained.push(source)
          continue
        }
        try {
          const target = join(targetRoot, name)
          if (stat(target) || (group === "state" && ADDRESSES.has(name))) {
            const archive = join(canonical, "migration-conflicts", group)
            mkdirSync(archive, { recursive: true })
            const preferred = join(archive, name)
            renameSync(source, stat(preferred) ? `${preferred}-${randomUUID()}` : preferred)
          } else {
            mkdirSync(targetRoot, { recursive: true })
            renameSync(source, target)
          }
          retired += 1
        } catch (error) {
          warnings.push(`retire ${source}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (readdirSync(sourceRoot).length === 0) rmdirSync(sourceRoot)
    }
  } catch (error) {
    warnings.push(`state retirement: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { retired, retained, warnings }
}
