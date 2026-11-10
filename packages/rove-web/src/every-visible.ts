/**
 * A poll that costs nothing while the page is hidden and catches up the moment
 * it is shown again. A tab in the background does not need fresh daemon data;
 * fourteen independent `setInterval`s did it anyway.
 */

export function everyVisible(ms: number, fn: () => void): () => void {
  const tick = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") fn()
  }
  const timer = window.setInterval(tick, ms)
  const onVisibility = () => {
    if (document.visibilityState === "visible") fn()
  }
  document.addEventListener("visibilitychange", onVisibility)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener("visibilitychange", onVisibility)
  }
}
