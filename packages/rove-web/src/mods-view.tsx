/**
 * The Mods page: every open mod pane, drawn from the same validated element tree the TUI draws
 * (`tui-react/component/mods-page.tsx`), with DOM elements instead of OpenTUI ones. Spacing steps
 * map to a fixed px scale; tones to the theme's tokens. Text is set as text, never as markup, so a
 * mod cannot put HTML in the page. A press goes back to the mod over `mod.press`; the redraw
 * arrives as the next `mods` push.
 */

import { en as modsEn, zh as modsZh } from "@sma1lboy/rove/src/tui/i18n/messages/mods.ts"
import {
  type ModButtonRef,
  type ModNode,
  type ModPaneView,
  modButtons,
  moveModCursor,
  resolveModCursor,
  sameModButton,
} from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"
import { type ReactNode, useRef, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { page, toast } from "./ui.ts"

const SPACE_PX = [0, 6, 12, 20] as const

function buttonId(ref: ModButtonRef): string {
  return `mod-btn:${ref.plugin}/${ref.pane}/${ref.key}`
}

interface TreeProps {
  readonly node: ModNode
  readonly pane: ModPaneView
  readonly cursor: ModButtonRef | null
  readonly onPress: (ref: ModButtonRef) => void
  readonly onFocus: (ref: ModButtonRef) => void
}

function ModTree(props: TreeProps): ReactNode {
  const { node } = props
  if (node.type === "text") {
    const cls = `mod-text${node.tone ? ` tone-${node.tone}` : ""}${node.bold ? " is-bold" : ""}`
    return <span className={cls}>{node.text}</span>
  }
  if (node.type === "button") {
    const ref = { plugin: props.pane.plugin, pane: props.pane.id, key: node.key }
    return (
      <button
        type="button"
        id={buttonId(ref)}
        className={`mod-button tone-${node.tone ?? "info"}${sameModButton(ref, props.cursor) ? " is-cursor" : ""}`}
        onFocus={() => props.onFocus(ref)}
        onClick={() => props.onPress(ref)}
      >
        {node.label}
      </button>
    )
  }
  return (
    <div
      className={`mod-box${node.border ? " is-framed" : ""}`}
      style={{
        flexDirection: node.direction ?? "column",
        gap: SPACE_PX[node.gap ?? 0],
        padding: SPACE_PX[node.padding ?? 0],
      }}
    >
      {node.children.map((child, i) => (
        // Children carry no stable id; position is the identity a redraw keeps.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <ModTree key={i} {...props} node={child} />
      ))}
    </div>
  )
}

export function ModsView({ model }: { model: AppModel }) {
  // The TUI's own copy, as the other rail pages share it.
  const copy = useLocale() === "zh" ? modsZh : modsEn
  const panes = useStore(model.mods)
  const buttons = modButtons(panes)
  const [rawCursor, setCursor] = useState<ModButtonRef | null>(null)
  const cursor = resolveModCursor(buttons, rawCursor)
  const root = usePageFocus()
  const pressing = useRef(false)

  const press = (ref: ModButtonRef): void => {
    setCursor(ref)
    if (pressing.current) return
    pressing.current = true
    model.client
      .request("mod.press", { plugin: ref.plugin, pane: ref.pane, key: ref.key })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : String(err), "error"))
      .finally(() => {
        pressing.current = false
      })
  }

  const move = (delta: -1 | 1): void => {
    const next = moveModCursor(buttons, cursor, delta)
    setCursor(next)
    if (next) document.getElementById(buttonId(next))?.focus()
  }

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
    switch (e.key) {
      case "Escape":
      case "q":
        page.set(null)
        return true
      case "ArrowDown":
        move(1)
        return true
      case "ArrowUp":
        move(-1)
        return true
      case "Enter":
        // A focused <button> already presses itself on Enter.
        if (e.target instanceof HTMLButtonElement) return false
        if (cursor) press(cursor)
        return true
      default:
        return false
    }
  })

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className="page mods-page" tabIndex={0} ref={root}>
      <div className="pg-top">
        <h1 className="page-title">{copy.title}</h1>
        <span className="pg-hint muted">{copy.keys}</span>
      </div>
      {panes.length === 0 ? (
        <div className="mods-empty">
          <p>{copy.empty}</p>
          <p className="muted">{copy.emptyHint}</p>
        </div>
      ) : (
        panes.map((pane) => (
          <section className="mod-pane" key={`${pane.plugin}/${pane.id}`}>
            <header className="mod-pane-title">
              {pane.title} <span className="muted">· {pane.plugin}</span>
            </header>
            <ModTree node={pane.tree} pane={pane} cursor={cursor} onPress={press} onFocus={setCursor} />
          </section>
        ))
      )}
    </div>
  )
}
