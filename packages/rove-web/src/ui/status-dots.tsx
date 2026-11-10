/**
 * A row's status as 3×3 dots in its tone, after ELYTerminal's session orb (MIT,
 * `src/sessions/orb.rs`). Every mark steps on one shared 80 ms clock that runs only while some
 * mark moves; the levels come from `dot-levels.ts` and are written straight to the dots.
 */

import { useLayoutEffect, useRef, useState } from "react"
import type { RowStatus } from "rove-bridge/protocol"
import { STEP_MS, dotLevels, dotsMove } from "../dot-levels.ts"
import { type DotLook, type Tone, statusMark } from "../rail-glyphs.ts"
import { TONE } from "./tone.ts"

/** Work and waiting under reduced motion run this many times slower instead of freezing. */
const GENTLE = 3

interface Mark {
  readonly el: HTMLElement
  readonly look: DotLook
  /** The clock step the mark mounted on, and how many steps its look had already lasted then. */
  readonly step: number
  readonly held: number
}

const marks = new Set<Mark>()
let timer: number | undefined

/** Paints a mark at clock `step`; false once it has settled and no longer needs the clock. */
function paint(mark: Mark, step: number): boolean {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const settledAt = Number.POSITIVE_INFINITY
  const held = mark.held + step - mark.step
  const moving = dotsMove(mark.look, reduced ? settledAt : held)
  const levels = dotLevels(mark.look, step, reduced ? settledAt : held, reduced ? GENTLE : 1)
  levels.forEach((level, dot) => {
    const style = (mark.el.children[dot] as HTMLElement).style
    style.opacity = level.toFixed(3)
  })
  return moving
}

function tick(): void {
  const step = Math.floor(performance.now() / STEP_MS)
  for (const mark of marks) if (!paint(mark, step)) marks.delete(mark)
  schedule()
}

/** Wakes just past the next clock step, so every mark paints on the same beat. */
function schedule(): void {
  timer = marks.size ? window.setTimeout(tick, STEP_MS - (performance.now() % STEP_MS) + 2) : undefined
}

function track(el: HTMLElement, look: DotLook, since: number): () => void {
  const step = Math.floor(performance.now() / STEP_MS)
  // `since` is the daemon's clock (0 when unknown): a look that began before this mount is already drawn.
  const age = since > 0 ? Math.max(Date.now() - since, 0) : Number.POSITIVE_INFINITY
  const mark: Mark = { el, look, step, held: Math.floor(age / STEP_MS) }
  if (paint(mark, step)) {
    marks.add(mark)
    if (timer === undefined) schedule()
  }
  return () => {
    marks.delete(mark)
  }
}

export function StatusDots({ status }: { status: RowStatus | undefined }) {
  const { look, tone } = statusMark(status)
  return <Dots key={look} look={look} tone={tone} since={status?.since ?? 0} />
}

// An idle mark is the muted ink, as ELYTerminal's `fg_muted`: one step stronger than the muted tone elsewhere.
const DOT_TONE = (tone: Tone): string => (tone === "muted" ? "text-muted" : tone === "ink" ? "text-ink" : TONE[tone])

function Dots({ look, tone, since }: { look: DotLook; tone: Tone; since: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  // Read once per mount: a later `since` of the same look must not redraw a shape.
  const [began] = useState(since)
  useLayoutEffect(() => {
    const el = ref.current
    return el ? track(el, look, began) : undefined
  }, [look, began])
  return (
    <span
      ref={ref}
      className={`inline-grid flex-none grid-cols-[repeat(3,3px)] auto-rows-[3px] gap-px self-center ${DOT_TONE(tone)}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, dot) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a dot's place is its identity
        <i key={dot} className="rounded-full bg-current opacity-12" />
      ))}
    </span>
  )
}
