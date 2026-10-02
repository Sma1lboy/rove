import { execFileSync } from "node:child_process"

function signal(pid, name) {
  try {
    process.kill(pid, name)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

/** Finish tree cleanup before the sidecar exits or the shell can orphan children. */
export function killPtyTree(pty) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pty.pid), "/T", "/F"], { stdio: "pipe" })
    } else {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
      const children = new Map()
      for (const row of rows.trim().split("\n")) {
        const [pid, parent] = row.trim().split(/\s+/).map(Number)
        const siblings = children.get(parent) ?? []
        siblings.push(pid)
        children.set(parent, siblings)
      }
      const descendants = []
      function visit(pid) {
        for (const child of children.get(pid) ?? []) visit(child)
        descendants.push(pid)
      }
      visit(pty.pid)
      // The PTY owns a session group; also walk PPIDs for children with new groups.
      for (const pid of descendants) signal(pid, "SIGKILL")
      signal(-pty.pid, "SIGKILL")
    }
  } catch (error) {
    console.error(`PTY tree cleanup failed for ${pty.pid}: ${error.message}`)
  } finally {
    try {
      pty.kill()
    } catch {
      // The tree kill may already have closed the PTY.
    }
  }
}
