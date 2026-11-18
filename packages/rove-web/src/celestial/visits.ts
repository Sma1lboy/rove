export type SkyScene = "orbit" | "comet" | "rings"

const KEY = "rove.web.lastSky"
function lastSky(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

let previous = lastSky()

/** Advance on opening a composer; renders, history and restored drafts keep the same sky. */
export function nextSky(): SkyScene {
  const next = previous === "orbit" ? "comet" : previous === "comet" ? "rings" : "orbit"
  previous = next
  try {
    sessionStorage.setItem(KEY, next)
  } catch {
    // The current tab still has its sequence.
  }
  return next
}
