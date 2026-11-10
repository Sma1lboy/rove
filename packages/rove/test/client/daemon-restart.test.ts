import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { restartDaemon, tryAcquireSpawnLock } from "@sma1lboy/rove-daemon/client/daemon-process"
import { describe, expect, it } from "vitest"

describe("restartDaemon", () => {
  it("holds the spawn lock from before the stop until the new daemon answers, so no other client starts its own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-restart-"))
    const lockPath = join(dir, "daemon.pid.spawn-lock")
    const seen: string[] = []
    let up = false
    // Another client, as its reconnect would try at each step.
    const rival = () => (tryAcquireSpawnLock(lockPath) ? "rival took the respawn" : "rival waits")
    await restartDaemon({
      lockPath,
      waitMs: 1_000,
      resolveSpawn: () => ["bun", "daemon", "start"],
      stop: async () => void seen.push(`stop: ${rival()}`),
      spawn: (command, args) => {
        seen.push(`spawn ${command} ${args.join(" ")}: ${rival()}`)
        setTimeout(() => {
          up = true
        }, 150)
      },
      responds: async () => {
        if (!up) seen.push(`not up yet: ${rival()}`)
        return up
      },
    })
    expect(seen[0]).toBe("stop: rival waits")
    expect(seen[1]).toBe("spawn bun daemon start: rival waits")
    expect(seen.slice(2).every((line) => line === "not up yet: rival waits")).toBe(true)
    expect(seen.length).toBeGreaterThan(2)
    // The new daemon answered: the lock is free again.
    expect(tryAcquireSpawnLock(lockPath)).toBe(true)
  })

  it("stops nothing when its own install is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-restart-"))
    let stopped = false
    await expect(
      restartDaemon({
        lockPath: join(dir, "daemon.pid.spawn-lock"),
        resolveSpawn: () => {
          throw new Error("install gone")
        },
        stop: async () => {
          stopped = true
        },
      }),
    ).rejects.toThrow("install gone")
    expect(stopped).toBe(false)
  })
})
