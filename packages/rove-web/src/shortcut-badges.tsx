/**
 * Prefix tap, "on-screen entries" mode: while the prefix is armed, the controls already on screen
 * that a prefix stroke reaches get a small keycap, next to the guide (the TUI's
 * `ShortcutRevealBadge`). "Guide only" mode shows the guide alone. Controls opt in with
 * `data-binding="<binding id>"`.
 */

export function ShortcutBadges({ rows }: { rows: readonly { id: string; stroke: string }[] }) {
  const placed = rows.flatMap((row) => {
    const el = document.querySelector(`[data-binding="${row.id}"]`)
    const box = el?.getBoundingClientRect()
    return box && box.width > 0 ? [{ ...row, x: box.right, y: box.top }] : []
  })
  return (
    <>
      {placed.map((p) => (
        <kbd key={p.id} className="shortcut-badge" style={{ left: p.x, top: p.y }}>
          {p.stroke}
        </kbd>
      ))}
    </>
  )
}
