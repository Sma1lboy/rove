/**
 * Open a path in the OS default app (file tree `o`, for media a TUI can't
 * play). WSL: `wslview`, else `explorer.exe` on the `wslpath -w` path; Linux:
 * `xdg-open`; macOS: `open`; Windows: cmd `start`. Detached and unref'd so
 * exit leaves no orphans.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { platform } from "node:os"
import type { Readable } from "node:stream"
import { spawnDetached } from "../../../lib/spawn-detached"

type EventedChild = {
  readonly stdout?: Readable | null
  on(event: "error", listener: (err: Error) => void): void
  on(event: "close", listener: (code: number | null) => void): void
  unref(): void
}

export function openExternally(absPath: string): void {
  if (!absPath) return
  const plat = platform()
  if (plat === "linux") {
    if (existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") || process.env.WSL_DISTRO_NAME) {
      // wslview ships in the wslu package, which may be absent.
      spawnDetachedWithFallback("wslview", [absPath], () => {
        const child = spawn("wslpath", ["-w", absPath], {
          stdio: ["ignore", "pipe", "ignore"],
        }) as unknown as EventedChild
        let out = ""
        child.stdout?.on("data", (b: Buffer) => {
          out += b.toString()
        })
        child.on("close", (code: number | null) => {
          if (code === 0) spawnDetachedWithFallback("explorer.exe", [out.trim()])
        })
      })
      return
    }
    spawnDetachedWithFallback("xdg-open", [absPath])
    return
  }
  if (plat === "darwin") {
    spawnDetachedWithFallback("open", [absPath])
    return
  }
  if (plat === "win32") {
    spawnDetachedWithFallback("cmd.exe", ["/c", "start", "", absPath])
    return
  }
}

function spawnDetachedWithFallback(cmd: string, args: readonly string[], onError?: () => void): void {
  spawnDetached(cmd, args, { onError: onError ? () => onError() : undefined })
}
