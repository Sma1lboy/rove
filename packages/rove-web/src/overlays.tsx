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
    setIndex(0)
    // Keep the menu on screen, like the TUI clamps it to the terminal.
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8),
    })
  }, [state])

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") menu.set(null)
      else if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => (i + 1) % state.items.length)
      else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => (i - 1 + state.items.length) % state.items.length)
      else if (e.key === "Enter") {
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
