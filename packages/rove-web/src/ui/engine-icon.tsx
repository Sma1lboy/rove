/**
 * An engine's brand mark at a row's start, in its brand colours (the row's ink where the brand is black or white);
 * a ring for an engine that declares none. Given a `status` it is also the row's status mark: it pulses while the
 * engine works, dims at rest, and gives way to `?` / `!` when the row needs a person.
 */

import type { StatusMark } from "../rail-glyphs.ts"
import { TONE_CLASS } from "./tone.ts"

export interface EngineIconData {
  readonly viewBox: string
  readonly paths: readonly { readonly d: string; readonly evenodd?: true; readonly fill?: string }[]
}

// 1px below the box centre: the title's lowercase sits 1.5px under it, its capitals 0.3px.
const CELL = "block size-3.5 flex-none translate-y-px"

/** Reduced motion slows the pulse instead of freezing it, as the dots do. */
const LOOK: Readonly<Record<StatusMark["look"], string>> = {
  working: "animate-mark-pulse motion-reduce:[animation-duration:4.8s]",
  done: "",
  idle: "opacity-45",
  waiting: "",
  error: "",
}

export function EngineIcon(props: {
  readonly icon: EngineIconData | undefined
  readonly name?: string | undefined
  /** The row's status, when the mark stands in for the dots. */
  readonly status?: StatusMark | undefined
}) {
  const look = props.status?.look
  if (look === "waiting" || look === "error") {
    return (
      <span
        className={`${CELL} text-center font-mono text-meta leading-3.5 font-semibold ${TONE_CLASS[props.status?.tone ?? "muted"]}`}
        aria-hidden="true"
      >
        {look === "waiting" ? "?" : "!"}
      </span>
    )
  }
  return (
    <svg
      className={`${CELL} ${props.icon ? "text-ink" : "text-muted"} ${look ? LOOK[look] : ""}`}
      viewBox={props.icon?.viewBox ?? "0 0 14 14"}
      role={props.name ? "img" : undefined}
      aria-label={props.name}
      aria-hidden={props.name ? undefined : true}
    >
      {props.icon ? (
        props.icon.paths.map((path) => (
          <path
            key={path.d}
            d={path.d}
            fill={path.fill ?? "currentColor"}
            fillRule={path.evenodd ? "evenodd" : undefined}
          />
        ))
      ) : (
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  )
}
