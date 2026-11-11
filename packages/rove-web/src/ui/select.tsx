import { useRef } from "react"
import { menu } from "../ui.ts"
import { Chevron } from "./chevron.tsx"

/**
 * A one-of-N choice in a drop-down: a field-like button that opens the app's own menu under it, at least as wide
 * as the button, with the current pick checked and highlighted. Names itself with `label`.
 */
export function Select<T extends string | number>({
  label,
  value,
  picks,
  onPick,
}: {
  label: string
  value: T
  picks: readonly { readonly value: T; readonly label: string }[]
  onPick: (next: T) => void
}) {
  // The press that closes an open menu must not reopen it on its click.
  const wasOpen = useRef(false)
  const open = (button: HTMLButtonElement) => {
    const box = button.getBoundingClientRect()
    menu.set({
      x: box.left,
      y: box.bottom + 4,
      right: box.right,
      minWidth: box.width,
      start: Math.max(
        picks.findIndex((pick) => pick.value === value),
        0,
      ),
      target: button,
      items: picks.map((pick) => ({
        label: pick.label,
        checked: pick.value === value,
        run: () => {
          // A pointer pick leaves focus on the closed menu's row: hand it back.
          button.focus()
          if (pick.value !== value) onPick(pick.value)
        },
      })),
    })
  }
  return (
    <button
      type="button"
      aria-label={`${label}: ${picks.find((pick) => pick.value === value)?.label ?? value}`}
      aria-haspopup="menu"
      className="relative inline-flex max-w-full min-w-0 items-center rounded-sm border-hairline border-line bg-paper py-1.25 pr-7 pl-2.5 text-left font-sans text-meta text-ink hover:border-line-active focus-visible:border-line-active focus-visible:outline-none data-menu-open:border-line-active touch:min-h-10"
      onMouseDown={(e) => {
        wasOpen.current = e.currentTarget.hasAttribute("data-menu-open")
      }}
      onClick={(e) => {
        if (!wasOpen.current) open(e.currentTarget)
        wasOpen.current = false
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        e.preventDefault()
        open(e.currentTarget)
      }}
    >
      <span className="min-w-0 truncate">{picks.find((pick) => pick.value === value)?.label ?? value}</span>
      <Chevron className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle" />
    </button>
  )
}
