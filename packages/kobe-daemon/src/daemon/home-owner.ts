/** Single-home daemon lease, held from bootstrap through shutdown. */
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type DaemonSocketState, probeDaemonSocket } from "../client/daemon-process.ts"
import { ROVE_STATE_DIR_BASENAME } from "../compat-env.ts"
import { isProcessAlive } from "./lifecycle.ts"
import { OWNER_ONLY_FILE_MODE, ensureOwnerOnlyStateDir } from "./owner-only.ts"

export interface HomeOwnerClaim {
  readonly pid: number
  readonly socketPath: string
}

export function daemonHomeOwnerPath(homeDir: string): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "daemon.owner")
}

export function parseHomeOwnerClaim(raw: string): HomeOwnerClaim | null {
  const at = raw.indexOf(":")
  const pid = Number(raw.slice(0, at))
  const socketPath = raw.slice(at + 1).trim()
  if (at <= 0 || !Number.isSafeInteger(pid) || pid <= 0 || !socketPath) return null
  return { pid, socketPath }
}

export async function readHomeOwnerClaim(homeDir: string): Promise<HomeOwnerClaim | null> {
  try {
    return parseHomeOwnerClaim(await readFile(daemonHomeOwnerPath(homeDir), "utf8"))
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null
    throw err
  }
}

/** Only the constructor differs between the production Bun runtime and Node's test runner. */
async function openLeaseDatabase(path: string) {
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite")
    return new Database(path, { create: true })
  }
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
  return new DatabaseSync(path)
}

async function acquireLeaseDatabase(path: string) {
  for (let attempt = 0; ; attempt++) {
    const database = await openLeaseDatabase(path)
    try {
      database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE")
      return database
    } catch (err) {
      database.close()
      const busy =
        err instanceof Error &&
        (("code" in err && err.code === "SQLITE_BUSY") || ("errcode" in err && err.errcode === 5))
      if (!busy || attempt >= 4) throw err
      // Concurrent first opens can both lose the shared-to-exclusive upgrade.
      // Release that connection before retrying; never reclaim or replace a lock.
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20))
    }
  }
}

/**
 * SQLite supplies the OS-backed exclusion and crash recovery. This file is
 * never unlinked: replacing its inode would let two processes hold locks on
 * different files. No tables, application data, or committed writes live here.
 * Like the daemon sockets, this lease is for a local filesystem.
 */
export async function acquireHomeClaim(options: {
  readonly homeDir: string
  readonly socketPath: string
  readonly probe?: (socketPath: string) => Promise<DaemonSocketState>
}): Promise<{ release(): Promise<void> }> {
  const { homeDir, socketPath, probe = probeDaemonSocket } = options
  await ensureOwnerOnlyStateDir(homeDir)
  const path = daemonHomeOwnerPath(homeDir)
  const database = await acquireLeaseDatabase(`${path}.lock`).catch((cause) => {
    throw new Error(
      `rove daemon: cannot acquire exclusive ownership of ${homeDir}; another daemon may be starting or running`,
      { cause },
    )
  })

  try {
    // An older daemon does not hold the SQLite lease. Its socket and PID must
    // still be checked, including a live process whose socket stopped answering.
    const claim = await readHomeOwnerClaim(homeDir)
    const incumbentSocket = claim?.socketPath ?? socketPath
    const incumbent = await probe(incumbentSocket)
    if (incumbent !== "absent" || (claim && isProcessAlive(claim.pid))) {
      throw new Error(
        `rove daemon: ${homeDir} is already served by the daemon on ${incumbentSocket}${claim ? ` (pid ${claim.pid})` : ""}; stop that daemon or choose a different ROVE_HOME_DIR`,
      )
    }
    if (incumbentSocket !== socketPath && (await probe(socketPath)) !== "absent") {
      throw new Error(`rove daemon: another daemon is already serving ${socketPath}; refusing to replace it`)
    }
    const staging = `${path}.${process.pid}.tmp`
    await writeFile(staging, `${process.pid}:${socketPath}\n`, { encoding: "utf8", mode: OWNER_ONLY_FILE_MODE })
    await rename(staging, path)
  } catch (err) {
    database.close()
    throw err
  }

  let released: Promise<void> | undefined
  return {
    release() {
      released ??= (async () => {
        try {
          const claim = await readHomeOwnerClaim(homeDir)
          if (claim?.pid === process.pid && claim.socketPath === socketPath) await unlink(path)
        } finally {
          database.close()
        }
      })()
      return released
    },
  }
}
