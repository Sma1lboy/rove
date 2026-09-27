export function processAlive(pid: number, kill?: (pid: number, signal: 0) => unknown): boolean

export interface WatchParentOptions {
  onGone(): void
  parentPid?: number
  currentPpid?: () => number
  isAlive?: (pid: number) => boolean
  intervalMs?: number
}

/** Returns a function that stops the watch. */
export function watchParent(options: WatchParentOptions): () => void
