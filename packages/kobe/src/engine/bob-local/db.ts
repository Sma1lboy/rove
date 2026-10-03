/**
 * Read-only access to Bob Shell's single SQLite store (`~/.bob/db/bob.db`).
 *
 * Bob keeps EVERY task and message in one database rather than per-session
 * transcript files, so there is no path to hand another agent and every read
 * here opens, queries and closes — a long-lived handle would hold a WAL reader
 * open across Bob's own writes.
 *
 * Only the constructor differs between the production Bun runtime and Node's
 * test runner (see `kobe-daemon/src/daemon/home-owner.ts`, same split).
 */

import { bobDbPath } from "../vendor-home.ts"

interface ReadOnlyDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
  close(): void
}

async function openReadOnly(path: string): Promise<ReadOnlyDb | null> {
  try {
    if (typeof Bun !== "undefined") {
      const { Database } = await import("bun:sqlite")
      return new Database(path, { readonly: true }) as unknown as ReadOnlyDb
    }
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
    return new DatabaseSync(path, { readOnly: true }) as unknown as ReadOnlyDb
  } catch {
    // No Bob install, no database yet, or a reader this runtime cannot open.
    // Every caller treats that as "no history", never as an error.
    return null
  }
}

/** Run one query and close. `[]` whenever anything at all goes wrong. */
export async function bobQuery<T>(sql: string, params: readonly unknown[], home?: string): Promise<readonly T[]> {
  const db = await openReadOnly(bobDbPath(home))
  if (!db) return []
  try {
    return db.prepare(sql).all(...params) as T[]
  } catch {
    return []
  } finally {
    try {
      db.close()
    } catch {
      /* already gone */
    }
  }
}
