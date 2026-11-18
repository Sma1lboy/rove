const scenes = ["orbit", "comet", "rings", "starlings"] as const
export type SkyScene = (typeof scenes)[number]

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
  const index = scenes.findIndex((scene) => scene === previous)
  const next = scenes[(index + 1) % scenes.length]
  previous = next
  try {
    sessionStorage.setItem(KEY, next)
  } catch {
    // The current tab still has its sequence.
  }
  return next
}
