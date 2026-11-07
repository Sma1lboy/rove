/**
 * TCP listeners on this machine, each with its owning process's cwd — what
 * `ports` attributes to a task. Linux reads /proc (no subprocess); elsewhere
 * `lsof`. `null` = could not scan, never "nothing is listening".
 */

import { readFileSync, readdirSync, readlinkSync } from "node:fs"
import { processCwd } from "../../engine/process-cwd.ts"

export interface ListeningSocket {
  readonly port: number
  /** Bound address as printed: `*`, `127.0.0.1`, `::1`, `0.0.0.0`, … */
  readonly host: string
  readonly pid: number
  readonly command: string
  /** Null when the process's cwd is unreadable. */
  readonly cwd: string | null
}

type RawListener = Omit<ListeningSocket, "cwd">

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpcn`: `p`/`c` open a process, each `n` is one socket. */
export function parseLsofListeners(output: string): RawListener[] {
  const rows: RawListener[] = []
  let pid = 0
  let command = ""
  for (const line of output.split("\n")) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === "p") {
      pid = Number.parseInt(value, 10)
      command = ""
    } else if (tag === "c") command = value
    else if (tag === "n" && pid > 0) {
      const sep = value.lastIndexOf(":")
      const port = Number.parseInt(value.slice(sep + 1), 10)
      if (sep < 0 || !Number.isInteger(port) || port <= 0) continue
      rows.push({ port, host: value.slice(0, sep).replace(/^\[|\]$/g, ""), pid, command })
    }
  }
  return rows
}

/** `/proc` stores each 32-bit word little-endian: `0100007F` → bytes 127,0,0,1. */
function procBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let w = 0; w < hex.length; w += 8) {
    for (const i of [6, 4, 2, 0]) bytes.push(Number.parseInt(hex.slice(w + i, w + i + 2), 16))
  }
  return bytes
}

/** An address as `lsof` prints it: dotted IPv4, IPv4-mapped IPv6 as `::ffff:a.b.c.d`, other IPv6 RFC 5952-compressed. */
function procAddress(hex: string): string {
  const bytes = procBytes(hex)
  if (bytes.length === 4) return bytes.join(".")
  const groups = Array.from({ length: 8 }, (_, g) => ((bytes[g * 2] ?? 0) << 8) | (bytes[g * 2 + 1] ?? 0))
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return `::ffff:${bytes.slice(12).join(".")}`
  // The longest run of two or more zero groups collapses to `::`; the first run wins a tie.
  let best = { at: -1, len: 1 }
  for (let i = 0; i < 8; ) {
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > best.len) best = { at: i, len: j - i }
    i = j === i ? i + 1 : j
  }
  const hexOf = (gs: number[]) => gs.map((g) => g.toString(16)).join(":")
  if (best.at < 0) return hexOf(groups)
  return `${hexOf(groups.slice(0, best.at))}::${hexOf(groups.slice(best.at + best.len))}`
}

/** Listening rows of a `/proc/net/tcp{,6}` table, keyed by socket inode. */
export function parseProcNetTcp(table: string): Map<string, { host: string; port: number }> {
  const out = new Map<string, { host: string; port: number }>()
  for (const line of table.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/)
    // cols: sl local rem st tx:rx tr:when retrnsmt uid timeout inode
    if (cols.length < 10 || cols[3] !== "0A") continue
    const [addr, portHex] = (cols[1] ?? "").split(":")
    if (!addr || !portHex) continue
    out.set(cols[9] ?? "", { host: procAddress(addr), port: Number.parseInt(portHex, 16) })
  }
  return out
}

function readProcListeners(): RawListener[] | null {
  const byInode = new Map<string, { host: string; port: number }>()
  let readAny = false
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      for (const [inode, row] of parseProcNetTcp(readFileSync(table, "utf8"))) byInode.set(inode, row)
      readAny = true
    } catch {
      /* tcp6 is absent on IPv4-only kernels */
    }
  }
  if (!readAny) return null
  const rows: RawListener[] = []
  if (byInode.size === 0) return rows
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 0) continue
    let fds: string[]
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue // another user's process, or gone
    }
    let command: string | null = null
    for (const fd of fds) {
      let link: string
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1]
      const sock = inode ? byInode.get(inode) : undefined
      if (!sock) continue
      if (command === null) {
        try {
          command = readFileSync(`/proc/${pid}/comm`, "utf8").trim()
        } catch {
          command = ""
        }
      }
      rows.push({ ...sock, pid, command })
    }
  }
  return rows
}

async function readLsofListeners(): Promise<RawListener[] | null> {
  try {
    const proc = Bun.spawn(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { stdout: "pipe", stderr: "ignore" })
    const out = await new Response(proc.stdout).text()
    // lsof exits 1 when nothing matched; an empty listing is still an answer.
    const code = await proc.exited
    return code === 0 || code === 1 ? parseLsofListeners(out) : null
  } catch {
    return null
  }
}

/** One row per (pid, port): a server bound on both IPv4 and IPv6 is one listener to a caller. */
export function dedupeListeners(rows: readonly RawListener[]): RawListener[] {
  const seen = new Map<string, RawListener>()
  for (const row of rows) {
    const key = `${row.pid}:${row.port}`
    if (!seen.has(key)) seen.set(key, row)
  }
  return [...seen.values()].sort((a, b) => a.port - b.port || a.pid - b.pid)
}

export async function scanListeningPorts(): Promise<ListeningSocket[] | null> {
  const raw = process.platform === "linux" ? readProcListeners() : await readLsofListeners()
  if (!raw) return null
  const rows = dedupeListeners(raw)
  const cwds = new Map<number, string | null>()
  for (const pid of new Set(rows.map((r) => r.pid))) cwds.set(pid, await processCwd(pid))
  return rows.map((r) => ({ ...r, cwd: cwds.get(r.pid) ?? null }))
}
