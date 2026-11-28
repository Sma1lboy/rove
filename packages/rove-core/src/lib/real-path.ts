import { realpathSync } from "node:fs"

/** Symlink-resolved `p`, or `p` unchanged when it doesn't exist (yet). */
export function realPathOrSelf(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
