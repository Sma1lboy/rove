// A page clock the capture script owns: timers, frames and CSS animations move only when __advance says so.
;(() => {
  let now = 0
  const start = Date.now()
  const realRaf = window.requestAnimationFrame.bind(window)
  const timers = new Map()
  let ids = 1
  let rafs = []
  const seen = new WeakSet()
  let fresh = new WeakSet()
  // Freeze every animation the moment it exists, also before the first advance.
  const hold = () => {
    for (const a of document.getAnimations())
      if (!seen.has(a)) {
        seen.add(a)
        fresh.add(a)
        a.pause()
        a.currentTime = 0
      }
  }
  const watch = () => {
    hold()
    realRaf(watch)
  }
  realRaf(watch)
  performance.now = () => now
  Date.now = () => start + now
  window.setTimeout = (fn, ms = 0, ...a) => {
    timers.set(ids, { at: now + (ms || 0), fn, a })
    return ids++
  }
  window.setInterval = (fn, ms = 0, ...a) => {
    timers.set(ids, { at: now + ms, fn, a, every: Math.max(ms, 1) })
    return ids++
  }
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id)
  window.requestAnimationFrame = (fn) => {
    rafs.push([ids, fn])
    return ids++
  }
  window.cancelAnimationFrame = (id) => {
    rafs = rafs.filter(([i]) => i !== id)
  }
  window.__advance = (dt) => {
    const target = now + dt
    for (;;) {
      let next = null
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t]
      if (!next) break
      now = Math.max(now, next[1].at)
      if (next[1].every) next[1].at += next[1].every
      else timers.delete(next[0])
      if (typeof next[1].fn === "function") next[1].fn(...next[1].a)
    }
    now = target
    const run = rafs
    rafs = []
    for (const [, fn] of run) fn(now)
    return new Promise((done) =>
      realRaf(() => {
        hold()
        for (const a of document.getAnimations()) if (!fresh.has(a)) a.currentTime = Number(a.currentTime) + dt
        fresh = new WeakSet()
        realRaf(() => realRaf(() => done(now)))
      }),
    )
  }
})()
