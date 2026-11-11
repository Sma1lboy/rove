/** An engine's brand mark at a row's start, in the row's ink; a ring for an engine that declares none. */

export interface EngineIconData {
  readonly viewBox: string
  readonly paths: readonly { readonly d: string; readonly evenodd?: true }[]
}

export function EngineIcon(props: { readonly icon: EngineIconData | undefined; readonly name?: string | undefined }) {
  return (
    <svg
      className="block size-3.5 flex-none text-muted"
      viewBox={props.icon?.viewBox ?? "0 0 14 14"}
      role={props.name ? "img" : undefined}
      aria-label={props.name}
      aria-hidden={props.name ? undefined : true}
    >
      {props.icon ? (
        props.icon.paths.map((path) => (
          <path key={path.d} d={path.d} fill="currentColor" fillRule={path.evenodd ? "evenodd" : undefined} />
        ))
      ) : (
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  )
}
