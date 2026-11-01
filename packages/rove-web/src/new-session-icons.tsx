/** The New session composer's chip glyphs. */

import * as C from "./ui/composer.ts"

export function FolderIcon() {
  return (
    <svg className={C.ICON} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  )
}

export function BranchIcon() {
  return (
    <svg className={C.ICON} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />
    </svg>
  )
}

export function ClipIcon() {
  return (
    <svg className={C.ICON} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 4.5 5.8 9.2a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5.2 5.2a4.2 4.2 0 0 0 6 6L13 9" />
    </svg>
  )
}
