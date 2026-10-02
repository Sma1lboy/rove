import { execFileSync } from "node:child_process"

function signal(pid, name) {
  try {
    process.kill(pid, name)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

/** Detached services belong to a different session, even while their PPID is ours. */
export function killPtyTree(pty) {
  try {
    if (process.platform !== "win32") {
      // macOS masks `sess`; a PTY's controlling terminal identifies its session.
      const scope = process.platform === "darwin" ? "tty" : "sess"
      const rows = execFileSync("ps", ["-axo", `pid=,${scope}=`], { encoding: "utf8" })
        .trim().split("\n").map((row) => row.trim().split(/\s+/))
      const session = rows.find(([pid]) => Number(pid) === pty.pid)?.[1]
      if (session && session !== "?" && session !== "??" && session !== "0") {
        for (const [pid, candidate] of rows) {
          if (candidate === session && Number(pid) !== pty.pid) signal(Number(pid), "SIGKILL")
        }
      }
      signal(-pty.pid, "SIGKILL")
    }
  } catch (error) {
    console.error(`PTY session cleanup failed for ${pty.pid}: ${error.message}`)
  } finally {
    try {
      // Windows node-pty cleans its console; taskkill /T crosses service boundaries.
      pty.kill()
    } catch {
      // POSIX session cleanup may already have closed the PTY.
    }
  }
}
