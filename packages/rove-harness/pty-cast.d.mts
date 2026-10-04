/** asciicast v2 recorder for one PTY tab (see pty-cast.mjs). */
export interface Cast {
  /** Append PTY output. */
  output(data: string): void
  /** Record a size change; repeats of the current size are dropped. */
  resize(cols: number, rows: number): void
  /** Storyboard marker — the cut addresses beats by these labels. */
  mark(label: string): void
  /** The tab's process was spawned again: reset the screen, then size it. */
  respawn(cols: number, rows: number): void
  /** Header line + one JSON event per line. */
  serialize(): string
}

export function createCast(opts: { cols: number; rows: number; now?: () => number }): Cast
