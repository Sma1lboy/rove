import { useEffect, useLayoutEffect, useRef } from "react"

/** Marks the bar `data-tight` while its first group overflows with every other chip showing its word. */
function fit(bar: HTMLElement | null): void {
  const left = bar?.firstElementChild
  if (!bar || !left) return
  delete bar.dataset.tight
  if (left.scrollWidth > left.clientWidth + 1) bar.dataset.tight = ""
}

/** Refits on every render (a label changed), on resize and once fonts land; toggling never resizes the bar itself. */
export function useTightBar() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => fit(ref.current))
  useEffect(() => {
    const bar = ref.current
    if (!bar) return
    const watch = new ResizeObserver(() => fit(bar))
    watch.observe(bar)
    void document.fonts.ready.then(() => fit(bar))
    return () => watch.disconnect()
  }, [])
  return ref
}
