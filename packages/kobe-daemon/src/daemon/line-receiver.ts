/** Request limit excludes the newline and counts wire bytes, not UTF-16 characters.
 * Matches the outbound queue budget; permits multi-megabyte prompts and PTY input.
 * Larger requests must be split by the caller before sending. */
export const MAX_REQUEST_FRAME_BYTES = 8 * 1024 * 1024

/** Each incoming byte is scanned once. Geometric storage growth amortizes copies;
 * decoding only complete lines preserves UTF-8 codepoints split across chunks. */
export class LineReceiver {
  private storage = Buffer.alloc(0)
  private length = 0
  private failed = false

  constructor(private readonly maxBytes = MAX_REQUEST_FRAME_BYTES) {}

  get pendingBytes(): number {
    return this.length
  }

  push(chunk: Buffer, onLine: (line: string) => void): boolean {
    if (this.failed) return false
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline === -1 ? chunk.length : newline
      const size = this.length + end - start
      if (size > this.maxBytes) {
        this.failed = true
        this.storage = Buffer.alloc(0)
        this.length = 0
        return false
      }
      if (size > this.storage.length) {
        const capacity = Math.min(this.maxBytes, Math.max(size, this.storage.length * 2, 1024))
        const grown = Buffer.allocUnsafe(capacity)
        this.storage.copy(grown, 0, 0, this.length)
        this.storage = grown
      }
      chunk.copy(this.storage, this.length, start, end)
      this.length = size
      if (newline === -1) return true
      const line = this.storage.toString("utf8", 0, this.length)
      this.length = 0
      onLine(line)
      start = newline + 1
    }
    return true
  }
}
