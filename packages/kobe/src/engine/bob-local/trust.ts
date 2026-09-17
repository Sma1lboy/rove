/**
 * IBM Bob Shell workspace trust. Bob opens a never-seen directory on a
 * "Do you trust this folder?" dialog (Trust this folder / Trust parent folder
 * / Don't trust), and a hosted session has no one to answer it. The launch
 * line already carries `--trust`, Bob's own switch for the same thing; this
 * pre-writes the record too, so a user launch command that drops the flag
 * still starts straight into the composer.
 *
 * The store is one file, `~/.bob/trustedFolders.json`:
 * `{ "version": 1, "folders": { "<directory>": "TRUST_FOLDER" } }` — read off
 * the bobshell 2.0.4 bundle, where `--trust` itself does
 * `setFolder(directory, "TRUST_FOLDER")` and the store's `normalize` keeps
 * only `version` and the `folders` map. Merge-preserving: other folders'
 * entries stay, a folder already trusted is left alone.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const TRUST_STORE_VERSION = 1
const TRUST_FOLDER = "TRUST_FOLDER"

export function bobTrustStorePath(home: string = homedir()): string {
  return path.join(home, ".bob", "trustedFolders.json")
}

type TrustStore = { version: number; folders: Record<string, unknown> }

function readStore(file: string): TrustStore {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return { version: TRUST_STORE_VERSION, folders: {} }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { version: TRUST_STORE_VERSION, folders: {} }
  }
  const record = parsed as Record<string, unknown>
  const folders =
    typeof record.folders === "object" && record.folders !== null && !Array.isArray(record.folders)
      ? { ...(record.folders as Record<string, unknown>) }
      : {}
  return { version: typeof record.version === "number" ? record.version : TRUST_STORE_VERSION, folders }
}

export function trustBobWorktree(worktreePath: string, home?: string): void {
  const file = bobTrustStorePath(home)
  const store = readStore(file)
  if (store.folders[worktreePath] === TRUST_FOLDER) return
  store.folders[worktreePath] = TRUST_FOLDER
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 })
}
