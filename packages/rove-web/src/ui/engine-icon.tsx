/** An engine's brand mark at a row's start, in its brand colours (the row's ink where the brand is black or white); a ring for an engine that declares none. */

export interface EngineIconData {
  readonly viewBox: string
  readonly paths: readonly { readonly d: string; readonly evenodd?: true; readonly fill?: string }[]
}

export function EngineIcon(props: { readonly icon: EngineIconData | undefined; readonly name?: string | undefined }) {
  return (
    <svg
      // 1px below the box centre: the title's lowercase sits 1.5px under it, its capitals 0.3px.
      className={`block size-3.5 flex-none translate-y-px ${props.icon ? "text-ink" : "text-muted"}`}
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
