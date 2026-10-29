import "./chevron.css"

/** The one disclosure glyph (a folder's fold, a project head, a submenu, an engine row): a thin chevron that points down and is turned by CSS (`.is-right`). */
export function Chevron(props: { readonly className?: string; readonly right?: boolean }) {
  return (
    <svg
      className={`chevron ${props.right ? "is-right" : ""} ${props.className ?? ""}`}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path
        d="M2.5 3.75 5 6.25l2.5-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
