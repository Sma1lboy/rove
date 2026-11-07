/** The one disclosure glyph (a folder's fold, a project head, a submenu, an engine row): a thin chevron that points down and is turned a quarter by `right`. */
export function Chevron(props: { readonly className?: string; readonly right?: boolean }) {
  return (
    <svg
      className={`block size-2.5 flex-none transition-[rotate,opacity] duration-120 ease-[ease] motion-reduce:transition-none ${props.right ? "-rotate-90 is-right" : ""} ${props.className ?? ""}`}
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
