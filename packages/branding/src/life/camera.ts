import { Easing } from "remotion"
import type { Stroke } from "./pen"
import { partStart } from "./timeline"

// The drawing field is a viewport onto model space, the way a CAD layout frames a
// model: each revision the camera pulls back to fit everything inked so far, so the
// sheet opens close on day 0 and only reaches 1:1 once the system fills it.

export const FIELD = { x: 40, y: 40, w: 1400, h: 820 }
export type Box = [number, number, number, number]
export type Camera = { s: number; cx: number; cy: number }

const PAD = 70
const MAX_ZOOM = 2.6
/** Every revision pulls back at least this much, so each one reads as growth. */
const STEP = 0.92
/** Frames a move takes; it lands on the revision's first frame, with the downbeat. */
const MOVE = 22

export const union = (a: Box | null, b: Box): Box =>
  a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b

export function strokesBox(strokes: Stroke[]): Box {
  let box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of strokes) for (const [x, y] of s) box = union(box, [x, y, x, y])
  return box
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One framing per revision, from the running union of model-space boxes (null: a sheet-space part). */
export function framings(boxes: (Box | null)[]): Camera[] {
  let seen: Box | null = null
  let prev = MAX_ZOOM / STEP
  return boxes.map((box, i) => {
    if (box) seen = union(seen, box)
    if (!seen) throw new Error("the first revision must draw in model space")
    const [x0, y0, x1, y1] = seen
    const fit = Math.min(FIELD.w / (x1 - x0 + 2 * PAD), FIELD.h / (y1 - y0 + 2 * PAD))
    const s = i === boxes.length - 1 ? 1 : Math.max(1, Math.min(MAX_ZOOM, fit, prev * STEP))
    prev = s
    const hw = FIELD.w / (2 * s)
    const hh = FIELD.h / (2 * s)
    return {
      s,
      cx: clamp((x0 + x1) / 2, FIELD.x + hw, FIELD.x + FIELD.w - hw),
      cy: clamp((y0 + y1) / 2, FIELD.y + hh, FIELD.y + FIELD.h - hh),
    }
  })
}

const ease = Easing.inOut(Easing.cubic)

/** Framing i holds until the move into i + 1, which ends on that revision's first frame. */
export function cameraAt(frame: number, cams: Camera[]): Camera {
  for (let i = cams.length - 1; i >= 1; i--) {
    const end = partStart(i)
    if (frame >= end) return cams[i]
    if (frame > end - MOVE) {
      const p = ease((frame - end + MOVE) / MOVE)
      const [a, b] = [cams[i - 1], cams[i]]
      return { s: a.s * (b.s / a.s) ** p, cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p }
    }
  }
  return cams[0]
}

export const viewTransform = ({ s, cx, cy }: Camera) =>
  `translate(${FIELD.x + FIELD.w / 2} ${FIELD.y + FIELD.h / 2}) scale(${s}) translate(${-cx} ${-cy})`
