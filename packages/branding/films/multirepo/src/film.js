// One paused GSAP timeline for the whole film. Every time comes from
// window.FILM, which scripts/build.mjs derives from clips/clips.json — nothing
// here knows how long a clip is. Motion is seek-safe: springs are ease
// functions, never onUpdate callbacks.
const { fps, scenes, total } = window.FILM
const F = 1 / fps

/** Remotion's spring(): unit step response from rest, closed form at `frame`. */
function springAt(frame, { damping, stiffness = 100, mass = 1 }) {
  const t = Math.max(0, frame) / fps
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const w0 = Math.sqrt(stiffness / mass)
  if (zeta < 1) {
    const w1 = w0 * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(w1 * t) + ((zeta * w0) / w1) * Math.sin(w1 * t))
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
  const w2 = w0 * Math.sqrt(zeta * zeta - 1)
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cosh(w2 * t) + ((zeta * w0) / w2) * Math.sinh(w2 * t))
}

/** Frames until the spring stays within 0.5% of 1 (Remotion's measureSpring). */
function settleFrames(config) {
  let frame = 0
  while (Math.abs(springAt(frame, config) - 1) >= 0.005) frame += 1
  let settled = frame
  for (let i = 0; i < 20; i += 1) {
    frame += 1
    if (Math.abs(springAt(frame, config) - 1) >= 0.005) {
      i = 0
      settled = frame + 1
    }
  }
  return settled
}

/** The spring stretched to `frames` frames, as a GSAP ease (may overshoot 1). */
function springEase(config, frames) {
  const natural = settleFrames(config)
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : springAt(p * natural, config))
}

const SOFT = { damping: 200 }
const tl = gsap.timeline({ paused: true })

/** fromTo with explicit start values, so seeking anywhere lands on the right pose. */
function seg(target, from, to, start, duration, ease = "none", first = false) {
  tl.fromTo(target, from, { ...to, duration, ease, immediateRender: first }, start)
}

tl.set("#win", { opacity: 0, y: 40, scale: 0.94 }, 0)
seg("#wall", { "--drift": 0 }, { "--drift": 1 }, 0, total, "none", true)

function caption(scene) {
  const cap = `#cap-${scene.index} .caption`
  const { end } = scene
  seg(cap, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, scene.start, 12 * F, springEase(SOFT, 12), true)
  seg(cap, { opacity: 1 }, { opacity: 0 }, end - 6 * F, 6 * F)
  for (const change of scene.kickers) {
    tl.set(`${cap} .k${change.slot - 1}`, { opacity: 0 }, change.at)
    seg(`${cap} .k${change.slot}`, { opacity: 0 }, { opacity: 1 }, change.at, 6 * F)
  }
}

function keycaps(scene) {
  const { end } = scene
  const pop = springEase({ damping: 12, stiffness: 220 }, 10)
  for (let i = 0; i < scene.keyCount; i += 1) {
    const key = `#keys-${scene.index} .key-${i}`
    const at = scene.start + i * 4 * F
    seg(key, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, at, 10 * F, pop, true)
    seg(key, { y: 0, "--press": 0 }, { y: 6, "--press": 6 }, at + 2 * F, 2 * F)
    seg(key, { y: 6, "--press": 6 }, { y: 0, "--press": 0 }, at + 4 * F, 3 * F)
  }
  seg(`#keys-${scene.index} .keys`, { opacity: 1 }, { opacity: 0 }, end - 5 * F, 5 * F)
}

function endCard(scene) {
  const enter = springEase(SOFT, 14)
  seg(".end-title", { opacity: 0, y: 16 }, { opacity: 1, y: 0 }, scene.start, 14 * F, enter, true)
  for (const part of [".end-cmd", ".end-site"]) {
    seg(part, { opacity: 0 }, { opacity: 1 }, scene.start + 8 * F, 14 * F, enter, true)
  }
}

function take(scene) {
  const { end } = scene
  if (scene.openIn) {
    seg("#win", { opacity: 0, y: 40, scale: 0.94 }, { opacity: 1, y: 0, scale: 1 }, scene.start, 16 * F, springEase({ damping: 18, stiffness: 140 }, 16))
  }
  if (scene.closeOut) {
    seg("#win", { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: 40, scale: 0.94 }, end - 0.55, 0.55, "power3.in")
  }
  if (scene.zoomSidebar) {
    seg("#zoomer", { scale: 1 }, { scale: 1.32 }, scene.start, 0.8, "power3.inOut")
    seg("#zoomer", { scale: 1.32 }, { scale: 1 }, end - 0.35, 0.35, "power3.inOut")
    seg("#ring-sidebar", { opacity: 0 }, { opacity: 1 }, scene.start + 0.6, 0.4)
    seg("#ring-sidebar", { opacity: 1 }, { opacity: 0 }, end - 0.5, 0.2)
  }
  if (scene.keyPress !== null) {
    const ring = `#ring-key-${scene.index}`
    const down = scene.keyPress
    seg(ring, { opacity: 0 }, { opacity: 1 }, down - 0.3, 0.3)
    seg(ring, { "--pulse": 0 }, { "--pulse": 1 }, down, 0.4)
    seg(ring, { opacity: 1 }, { opacity: 0 }, down + 0.9, 0.3)
  }
}

for (const [i, scene] of scenes.entries()) {
  if (scene.hasCaption) caption(scene)
  if (scene.kind === "keys") keycaps(scene)
  if (scene.kind === "end") endCard(scene)
  if (scene.kind === "take") {
    take(scene)
    // A scene that does not hand over to another take cuts the window away.
    if (scenes[i + 1]?.kind !== "take") tl.set("#win", { opacity: 0 }, scene.end)
  }
}

window.__timelines["main"] = tl
