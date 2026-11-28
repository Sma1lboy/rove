/**
 * An engine's brand mark at a row's start; a ring for an engine that declares none. Alone it is drawn in its brand
 * colours (the row's ink where the brand is black or white). Given a `status` it is the row's status mark: the shape
 * says which engine, the colour says the state (dim at rest, green for an unseen finish, the accent breathing while
 * it works), and it gives way to `?` / `!` when the row needs a person.
 */

import { useId } from "react"
import type { StatusMark } from "../rail-glyphs.ts"
import { TONE_CLASS } from "./tone.ts"

export interface EngineIconData {
  readonly viewBox: string
  readonly paths: readonly {
    readonly d: string
    readonly evenodd?: true
    readonly fill?: string
    /** `[x1, y1, x2, y2]`: the fill runs out to transparent along this line. */
    readonly fade?: readonly [number, number, number, number]
  }[]
}

// 1px below the box centre: the title's lowercase sits 1.5px under it, its capitals 0.3px.
/** 18px in the phone layout. */
const CELL = "block size-4 flex-none translate-y-px narrow:size-4.5"

/** Reduced motion slows the breath instead of freezing it, as the dots do. */
const BREATH = "animate-mark-pulse motion-reduce:[animation-duration:4.8s]"

export function EngineIcon(props: {
  readonly icon: EngineIconData | undefined
  readonly name?: string | undefined
  /** The row's status, when the mark stands in for the dots. */
  readonly status?: StatusMark | undefined
  /** No coding agent behind the row: an empty cell, so its title lines up with its neighbours'. */
  readonly blank?: boolean
}) {
  const id = useId()
  if (props.blank) return <span className={CELL} aria-hidden="true" />
  const look = props.status?.look
  if (look === "waiting" || look === "error") {
    return (
      <span
        className={`${CELL} text-center font-mono text-meta leading-4 font-semibold ${TONE_CLASS[props.status?.tone ?? "muted"]}`}
        aria-hidden="true"
      >
        {look === "waiting" ? "?" : "!"}
      </span>
    )
  }
  // A resting mark is the muted ink, as an idle dot mark: one step stronger than the muted tone elsewhere.
  const tone = props.status && (look === "idle" ? "text-muted" : TONE_CLASS[props.status.tone])
  return (
    <svg
      className={`${CELL} ${tone ?? (props.icon ? "text-ink" : "text-muted")} ${look === "working" ? BREATH : ""}`}
      viewBox={props.icon?.viewBox ?? "0 0 14 14"}
      role={props.name ? "img" : undefined}
      aria-label={props.name}
      aria-hidden={props.name ? undefined : true}
    >
      {props.icon ? (
        // A mark carrying the status is one flat colour, so its fading layers add nothing.
        props.icon.paths.map((path, i) =>
          path.fade && !tone ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: layers share one outline and never reorder
            <g key={i}>
              <linearGradient
                id={`${id}-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={path.fade[0]}
                y1={path.fade[1]}
                x2={path.fade[2]}
                y2={path.fade[3]}
              >
                <stop stopColor={path.fill ?? "currentColor"} />
                <stop offset="1" stopColor={path.fill ?? "currentColor"} stopOpacity="0" />
              </linearGradient>
              <path d={path.d} fill={`url(#${id}-${i})`} fillRule={path.evenodd ? "evenodd" : undefined} />
            </g>
          ) : path.fade ? null : (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: layers share one outline and never reorder
              key={i}
              d={path.d}
              fill={tone ? "currentColor" : (path.fill ?? "currentColor")}
              fillRule={path.evenodd ? "evenodd" : undefined}
            />
          ),
        )
      ) : (
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  )
}
