import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs"
import { open } from "node:fs/promises"

const MAX_ENGINE_FILE_BYTES = 100 * 1024 * 1024
export const MAX_JSONL_LINE_CHARS = 8 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const READ_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK

/** Cap bytes on the open handle, including growth after stat and path replacement. */
export async function readTextFileBounded(p: string, maxBytes = MAX_ENGINE_FILE_BYTES): Promise<string> {
  const file = await open(p, READ_FLAGS)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxBytes) return ""
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total))
      const { bytesRead } = await file.read(buffer)
      if (bytesRead === 0) return Buffer.concat(chunks, total).toString("utf8")
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
    }
    return ""
  } finally {
    await file.close()
  }
}

/** Metadata discovery reads the first nonblank line, never the transcript body. */
export async function readFirstLineBounded(p: string, maxBytes = MAX_JSONL_LINE_CHARS): Promise<string> {
  const file = await open(p, READ_FLAGS)
  try {
    if (!(await file.stat()).isFile()) return ""
    const chunks: Buffer[] = []
    let total = 0
    let start = 0
    let nonblank = false
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await file.read(buffer)
      if (!bytesRead) return Buffer.concat(chunks, total).subarray(start).toString("utf8")
      chunks.push(buffer.subarray(0, bytesRead))
      let segment = 0
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] !== 10) continue
        nonblank ||= buffer.subarray(segment, i).toString("utf8").trim().length > 0
        const end = total + i
        if (end > maxBytes) return ""
        if (nonblank)
          return Buffer.concat(chunks, total + bytesRead)
            .subarray(start, end)
            .toString("utf8")
        start = end + 1
        segment = i + 1
      }
      nonblank ||= buffer.subarray(segment, bytesRead).toString("utf8").trim().length > 0
      total += bytesRead
    }
    return ""
  } finally {
    await file.close()
  }
}

/** Missing or oversized credentials retain the existing not-detected result. */
export function readTextFileSyncBounded(p: string, maxBytes = MAX_ENGINE_FILE_BYTES): string | null {
  let fd: number
  try {
    fd = openSync(p, READ_FLAGS)
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null
    throw err
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > maxBytes) return null
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total))
      const bytesRead = readSync(fd, buffer)
      if (!bytesRead) return Buffer.concat(chunks, total).toString("utf8")
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
    }
    return null
  } finally {
    closeSync(fd)
  }
}

export function isJsonlLineWithinBound(line: string, maxChars = MAX_JSONL_LINE_CHARS): boolean {
  return line.length <= maxChars
}
