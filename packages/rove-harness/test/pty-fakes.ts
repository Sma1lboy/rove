/** Test doubles for the PTY session manager (node-pty process + ws socket). */

import { EventEmitter } from "node:events"
import { createScrollback } from "../pty-scrollback.mjs"
import { createPtySessionManager } from "../pty-session-lifecycle.mjs"

export class FakePty {
  data: ((data: string) => void) | null = null
  exit: (() => void) | null = null
  writes: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  killed = false
  paused = false
  pauseCount = 0
  resumeCount = 0

  onData(cb: (data: string) => void): void {
    this.data = cb
  }

  onExit(cb: () => void): void {
    this.exit = cb
  }

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  pause(): void {
    this.paused = true
    this.pauseCount += 1
  }

  resume(): void {
    this.paused = false
    this.resumeCount += 1
  }

  kill(): void {
    this.killed = true
  }

  emitData(data: string): void {
    this.data?.(data)
  }

  emitExit(): void {
    this.exit?.()
  }
}

export class FakeSocket extends EventEmitter {
  OPEN = 1
  readyState = this.OPEN
  bufferedAmount = 0
  sent: string[] = []
  closes: Array<{ code?: number; reason?: string }> = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason })
    this.readyState = 3
    this.emit("close")
  }

  message(data: string): void {
    this.emit("message", Buffer.from(data))
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

export function setup(over: Partial<Parameters<typeof createPtySessionManager>[0]> = {}) {
  const ptys: FakePty[] = []
  const fetchCalls: Array<{ taskId: string; mode: string }> = []
  const manager = createPtySessionManager({
    fetchSpec: async (taskId, mode) => {
      fetchCalls.push({ taskId, mode })
      return { cwd: `/repo/${taskId}`, command: ["engine", "--mode", mode] }
    },
    spawnPty: () => {
      const pty = new FakePty()
      ptys.push(pty)
      return pty
    },
    createScrollback,
    scrollbackCap: 1024,
    env: {},
    ...over,
  })
  return { manager, ptys, fetchCalls }
}

