/** The one open menu or dialog, and the toast stack. Esc / outside click dismisses a menu (TUI tree menu). */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useStore } from "./store.ts"
import { dialog, dismissToast, menu, toasts } from "./ui.ts"

function ContextMenu() {
  const state = useStore(menu)
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!state || !ref.current) return
    // A pointer-opened menu highlights nothing until the pointer or a key picks an entry.
    setIndex(state.fromKeyboard ? 0 : -1)
    // Flip to the pointer's other side when the menu would run off screen, as native menus do.
    const { width, height } = ref.current.getBoundingClientRect()
    const flip = (at: number, size: number, room: number) =>
      at + size + 8 <= room ? at : Math.max(8, Math.min(at - size, room - size - 8))
    setPos({ x: flip(state.x, width, window.innerWidth), y: flip(state.y, height, window.innerHeight) })
    const target = state.target
    target?.setAttribute("data-menu-open", "")
    return () => target?.removeAttribute("data-menu-open")
  }, [state])

  useEffect(() => {
    if (!state) return
    const last = state.items.length - 1
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") menu.set(null)
      else if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => (i >= last ? 0 : i + 1))
      else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => (i <= 0 ? last : i - 1))
      else if (e.key === "Home") setIndex(0)
      else if (e.key === "End") setIndex(last)
      else if (e.key === "Enter") {
        // Nothing highlighted yet: swallow it, so it doesn't reach the row under the menu.
        if (index < 0) return e.preventDefault()
        menu.set(null)
        state.items[index]?.run()
      } else return
      e.preventDefault()
    }
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) menu.set(null)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onDown)
    }
  }, [state, index])

  if (!state) return null
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {state.items.map((item, i) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className={`menu-item ${i === index ? "is-selected" : ""} ${item.danger ? "is-danger" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onMouseLeave={() => setIndex(-1)}
          onClick={() => {
            menu.set(null)
            item.run()
          }}
        >
          <span>{item.label}</span>
          {item.key && <span className="menu-key">{item.key}</span>}
        </button>
      ))}
    </div>
  )
}

export function Overlays() {
  const current = useStore(dialog)
  const list = useStore(toasts)
  return (
    <>
      <ContextMenu />
      {current}
      <div className="toasts" aria-live="polite">
        {list.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`toast ${item.tone === "error" ? "is-error" : ""}`}
            onClick={() => dismissToast(item.id)}
          >
            {item.text}
          </button>
        ))}
      </div>
    </>
  )
}
