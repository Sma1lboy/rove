/** The one open menu or dialog, and the toast stack. Esc / outside click dismisses a menu (TUI tree menu). */

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useStore } from "./store.ts"
import { type MenuItem, dialog, dismissToast, menu, toasts } from "./ui.ts"
import { Chevron } from "./ui/chevron.tsx"
import {
  MENU_CHECK,
  MENU_SEP,
  TOASTS,
  menuChevronClass,
  menuClass,
  menuItemClass,
  menuKeyClass,
  toastClass,
} from "./ui/overlay.ts"

/** How long the pointer rests on `Set status ›` before its choices open, so a diagonal sweep past it doesn't flash them. */
const SUB_OPEN_MS = 120

/** Flip to the anchor's other side when the box would run off screen, as native menus do. */
function flip(at: number, size: number, room: number, other = at - size): number {
  return at + size + 8 <= room ? at : Math.max(8, Math.min(other, room - size - 8))
}

function MenuRow(props: {
  item: MenuItem
  selected: boolean
  open?: boolean
  onEnter: () => void
  onLeave: () => void
  onPick: () => void
  rowRef?: (el: HTMLButtonElement | null) => void
}) {
  const { item } = props
  return (
    <button
      ref={props.rowRef}
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={item.checked}
      aria-haspopup={item.children ? "menu" : undefined}
      aria-expanded={item.children ? Boolean(props.open) : undefined}
      className={menuItemClass({ selected: props.selected, open: props.open, danger: item.danger })}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      onClick={props.onPick}
    >
      <span>{item.label}</span>
      {item.children ? (
        <Chevron right className={menuChevronClass(Boolean(props.selected || props.open))} />
      ) : item.checked ? (
        <span className={MENU_CHECK} aria-hidden>
          ✓
        </span>
      ) : (
        item.key && <span className={menuKeyClass({ selected: props.selected, danger: item.danger })}>{item.key}</span>
      )}
    </button>
  )
}

function ContextMenu() {
  const state = useStore(menu)
  const [index, setIndex] = useState(0)
  // The entry whose choices are open to the side, the highlight among them, and whether keys drive them.
  const [sub, setSub] = useState<number | null>(null)
  const [subIndex, setSubIndex] = useState(-1)
  const [inSub, setInSub] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef<number | undefined>(undefined)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [subPos, setSubPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!state || !ref.current) return
    // A pointer-opened menu highlights nothing until the pointer or a key picks an entry.
    setIndex(state.fromKeyboard ? 0 : -1)
    setSub(null)
    setInSub(false)
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({ x: flip(state.x, width, window.innerWidth), y: flip(state.y, height, window.innerHeight) })
    const target = state.target
    target?.setAttribute("data-menu-open", "")
    return () => target?.removeAttribute("data-menu-open")
  }, [state])

  // The choices open beside their entry, their first row level with it; to the left when the right has no room.
  useLayoutEffect(() => {
    const row = sub === null ? null : rows.current[sub]
    if (!row || !ref.current || !subRef.current) return
    const outer = ref.current.getBoundingClientRect()
    const anchor = row.getBoundingClientRect()
    const { width, height } = subRef.current.getBoundingClientRect()
    setSubPos({
      x: flip(outer.right + 2, width, window.innerWidth, outer.left - width - 2),
      y: flip(anchor.top - 5, height, window.innerHeight, anchor.bottom + 5 - height),
    })
  }, [sub])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!state) return
    const items = state.items
    const children = sub === null ? [] : (items[sub]?.children ?? [])
    const close = () => menu.set(null)
    const pick = (item: MenuItem | undefined) => {
      if (!item?.run) return
      close()
      item.run()
    }
    const cycle = (set: (f: (i: number) => number) => void, last: number, step: 1 | -1) =>
      set((i) => (step === 1 ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1))
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (inSub && sub !== null) {
        const last = children.length - 1
        if (k === "Escape" || k === "ArrowLeft" || k === "h") {
          setSub(null)
          setInSub(false)
        } else if (k === "ArrowDown" || k === "j") cycle(setSubIndex, last, 1)
        else if (k === "ArrowUp" || k === "k") cycle(setSubIndex, last, -1)
        else if (k === "Home") setSubIndex(0)
        else if (k === "End") setSubIndex(last)
        else if (k === "Enter") pick(children[subIndex])
        else return
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const last = items.length - 1
      const here = items[index]
      const openHere = () => {
        setSub(index)
        setInSub(true)
        setSubIndex(0)
      }
      if (k === "Escape") close()
      else if (k === "ArrowDown" || k === "j") cycle(setIndex, last, 1)
      else if (k === "ArrowUp" || k === "k") cycle(setIndex, last, -1)
      else if (k === "Home") setIndex(0)
      else if (k === "End") setIndex(last)
      else if ((k === "ArrowRight" || k === "l") && here?.children) openHere()
      // Nothing highlighted yet: Enter is swallowed, so it doesn't reach the row under the menu.
      else if (k === "Enter") {
        if (here?.children) openHere()
        else pick(here)
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = (e: MouseEvent) => {
      const inside = e.target instanceof Node && (ref.current?.contains(e.target) || subRef.current?.contains(e.target))
      if (!inside) close()
    }
    // Capture phase: a menu opened over the terminal still gets its keys, which xterm would otherwise stop at itself.
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("mousedown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("mousedown", onDown)
    }
  }, [state, index, sub, subIndex, inSub])

  if (!state) return null
  const children = sub === null ? null : state.items[sub]?.children
  const pick = (item: MenuItem) => {
    if (!item.run) return
    menu.set(null)
    item.run()
  }
  const openSub = (i: number) => {
    window.clearTimeout(timer.current)
    setSub(i)
    setInSub(false)
    setSubIndex(-1)
  }
  return (
    <>
      <div ref={ref} className={menuClass()} role="menu" style={{ left: pos.x, top: pos.y }}>
        {state.items.map((item, i) => (
          <Fragment key={item.label}>
            {i > 0 && item.section !== state.items[i - 1]?.section && <hr className={MENU_SEP} />}
            <MenuRow
              item={item}
              rowRef={(el) => {
                rows.current[i] = el
              }}
              selected={i === index}
              open={i === sub}
              onEnter={() => {
                setIndex(i)
                window.clearTimeout(timer.current)
                if (item.children) timer.current = window.setTimeout(() => openSub(i), SUB_OPEN_MS)
                else setSub(null)
              }}
              onLeave={() => {
                window.clearTimeout(timer.current)
                if (i !== sub) setIndex(-1)
              }}
              onPick={() => (item.children ? openSub(i) : pick(item))}
            />
          </Fragment>
        ))}
      </div>
      {children && (
        <div ref={subRef} className={menuClass(true)} role="menu" style={{ left: subPos.x, top: subPos.y }}>
          {children.map((item, i) => (
            <MenuRow
              key={item.label}
              item={item}
              selected={i === subIndex}
              onEnter={() => {
                setSubIndex(i)
                setInSub(true)
              }}
              onLeave={() => setSubIndex(-1)}
              onPick={() => pick(item)}
            />
          ))}
        </div>
      )}
    </>
  )
}

export function Overlays() {
  const current = useStore(dialog)
  const list = useStore(toasts)
  return (
    <>
      <ContextMenu />
      {current}
      <div className={TOASTS} aria-live="polite">
        {list.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`${toastClass(item.tone === "error")} ${item.leaving ? "is-leaving" : ""}`}
            onClick={() => dismissToast(item.id)}
          >
            {item.text}
          </button>
        ))}
      </div>
    </>
  )
}
