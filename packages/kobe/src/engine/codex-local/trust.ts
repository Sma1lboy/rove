/**
 * Codex pre-trust appends a project table while preserving the user's TOML
 * bytes. The existing local lock serializes Rove writers. Codex management
 * commands do not take that lock, so their concurrent edits remain a race.
 */

import { appendFileSync, closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { TomlError, type TomlTable, parse as parseToml } from "smol-toml"
import { isObject } from "../json-hooks.ts"
import { readSharedConfigSync } from "../shared-config-write.ts"
import { vendorConfigHome, vendorWriteHomeDeps } from "../vendor-home.ts"

const TRUST_LINE = 'trust_level = "trusted"'
const LOCK_NAME = "config.toml.rove.lock"
const LOCK_TIMEOUT_MS = 5_000
const LOCK_POLL_MS = 10
const MAX_DUPLICATE_REPAIRS = 5

export function trustCodexWorktree(worktreePath: string, home?: string): void {
  const dir = vendorConfigHome("codex", vendorWriteHomeDeps(home))
  const file = path.join(dir, "config.toml")
  const header = `[projects.${JSON.stringify(worktreePath)}]`
  mkdirSync(dir, { recursive: true })
  withConfigLock(path.join(dir, LOCK_NAME), () => {
    const before = readSharedConfigSync(file) ?? ""
    const { text, doc } = parseTrustConfig(before)
    const exists = isObject(doc.projects) && Object.hasOwn(doc.projects, worktreePath)
    const lead = text.length > 0 && !text.endsWith("\n") ? "\n" : ""
    const addition = exists ? "" : `${lead}\n${header}\n${TRUST_LINE}\n`
    try {
      parseToml(text + addition)
    } catch {
      throw new Error("Cannot add Codex trust without changing existing TOML")
    }
    if (text !== before) writeFileSync(file, text + addition, { mode: 0o600 })
    else if (addition) appendFileSync(file, addition, { mode: 0o600 })
  })
}

/** Repair only an exact duplicate, standalone trust table identified by the parser. */
function parseTrustConfig(original: string): { text: string; doc: TomlTable } {
  let text = original
  for (let repairs = 0; ; repairs++) {
    try {
      return { text, doc: parseToml(text) }
    } catch (error) {
      if (!(error instanceof TomlError) || repairs >= MAX_DUPLICATE_REPAIRS) break
      const lines = text.split("\n")
      const index = error.line - 1
      const header = lines[index]
      if (!header || !/^\[projects\."(?:[^"\\]|\\.)*"\]$/.test(header) || lines[index + 1] !== TRUST_LINE) break
      let next = index + 2
      while (next < lines.length && lines[next].trim() === "") next++
      if (next < lines.length && !lines[next].startsWith("[")) break
      try {
        const prior = parseToml(lines.slice(0, index).join("\n"))
        const duplicate = parseToml(`${header}\n${TRUST_LINE}`)
        if (!isObject(prior.projects) || !isObject(duplicate.projects)) break
        const project = Object.keys(duplicate.projects)[0]
        if (!project || !Object.hasOwn(prior.projects, project)) break
        const trusted = prior.projects[project]
        if (!isObject(trusted) || Object.keys(trusted).length !== 1 || trusted.trust_level !== "trusted") break
      } catch {
        break
      }
      lines.splice(index, 2)
      text = lines.join("\n")
    }
  }
  throw new Error("Codex trust config is invalid; leaving it unchanged")
}

function withConfigLock(lockPath: string, fn: () => void): void {
  let fd: number
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    try {
      fd = openSync(lockPath, "wx")
      break
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      if (Date.now() >= deadline) throw new Error("Timed out waiting for Codex config lock")
      Atomics.wait(sleeper, 0, 0, LOCK_POLL_MS)
    }
  }
  try {
    writeFileSync(fd, String(process.pid))
    fn()
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {
      /* Another process may have removed the lock. */
    }
  }
}
