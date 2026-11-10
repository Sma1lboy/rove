/**
 * The Mods page: every open mod pane, drawn from the same validated element tree the TUI draws
 * (`tui-react/component/mods-page.tsx`), with DOM elements instead of OpenTUI ones. Spacing steps
 * map to a fixed px scale; tones to the theme's tokens. Text is set as text, never as markup, so a
 * mod cannot put HTML in the page. A press goes back to the mod over `mod.press` and a submitted
 * field over `mod.submit`; the redraw arrives as the next `mods` push.
 */

import { en as modsEn, zh as modsZh } from "@sma1lboy/rove/src/tui/i18n/messages/mods.ts"
import {
  type ModControlRef,
  type ModNode,
  type ModPaneView,
  modControls,
  moveModCursor,
  resolveModCursor,
  sameModControl,
} from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"
import { type ReactNode, useRef, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { page, toast } from "./ui.ts"
import {
  MODS_EMPTY,
  MODS_PAGE,
  MOD_FIELD,
  MOD_FIELD_INPUT,
  MOD_PANE,
  MOD_PANE_TITLE,
  modBoxClass,
  modButtonClass,
  modTextClass,
} from "./ui/mods.ts"
import { PAGE_SCROLL, PAGE_TITLE, PG_TOP, pgHintClass } from "./ui/page.ts"
import { INPUT } from "./ui/text.ts"

const SPACE_PX = [0, 6, 12, 20] as const

function controlId(ref: ModControlRef): string {
  return `mod-${ref.kind}:${ref.plugin}/${ref.pane}/${ref.key}`
}

interface TreeProps {
  readonly node: ModNode
  readonly pane: ModPaneView
  readonly cursor: ModControlRef | null
  readonly onPress: (ref: ModControlRef) => void
  readonly onSubmit: (ref: ModControlRef, value: string) => void
  readonly onFocus: (ref: ModControlRef) => void
}

/** A field keeps the user's typing until the mod draws it with a new `value` (its React key). */
function ModField(props: {
  readonly id: string
  readonly placeholder?: string
  readonly value?: string
  readonly onFocus: () => void
  readonly onSubmit: (value: string) => void
}) {
  const [draft, setDraft] = useState(props.value ?? "")
  return (
    <form
      className={MOD_FIELD}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit(draft)
        setDraft(props.value ?? "")
      }}
    >
      <input
        id={props.id}
        className={`${INPUT} ${MOD_FIELD_INPUT}`}
        spellCheck={false}
        value={draft}
        placeholder={props.placeholder}
        onFocus={props.onFocus}
        onChange={(e) => setDraft(e.target.value)}
      />
    </form>
  )
}

function ModTree(props: TreeProps): ReactNode {
  const { node } = props
  if (node.type === "text") {
    return <span className={modTextClass(node.tone, node.bold === true)}>{node.text}</span>
  }
  if (node.type === "input") {
    const ref = { kind: "input" as const, plugin: props.pane.plugin, pane: props.pane.id, key: node.key }
    return (
      <ModField
        key={node.value ?? ""}
        id={controlId(ref)}
        placeholder={node.placeholder}
        value={node.value}
        onFocus={() => props.onFocus(ref)}
        onSubmit={(value) => props.onSubmit(ref, value)}
      />
    )
  }
  if (node.type === "button") {
    const ref = { kind: "button" as const, plugin: props.pane.plugin, pane: props.pane.id, key: node.key }
    return (
      <button
        type="button"
        id={controlId(ref)}
        className={modButtonClass(node.tone ?? "info", sameModControl(ref, props.cursor))}
        onFocus={() => props.onFocus(ref)}
        onClick={() => props.onPress(ref)}
      >
        {node.label}
      </button>
    )
  }
  return (
    <div
      className={modBoxClass(node.direction === "row", node.border === true)}
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
  const controls = modControls(panes)
  const [rawCursor, setCursor] = useState<ModControlRef | null>(null)
  const cursor = resolveModCursor(controls, rawCursor)
  const root = usePageFocus()
  const pressing = useRef(false)

  const send = (ref: ModControlRef, op: "mod.press" | "mod.submit", extra: Record<string, unknown> = {}): void => {
    setCursor(ref)
    if (pressing.current) return
    pressing.current = true
    model.client
      .request(op, { plugin: ref.plugin, pane: ref.pane, key: ref.key, ...extra })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : String(err), "error"))
      .finally(() => {
        pressing.current = false
      })
  }
  const press = (ref: ModControlRef): void => send(ref, "mod.press")
  const submit = (ref: ModControlRef, value: string): void => send(ref, "mod.submit", { value })

  const move = (delta: -1 | 1): void => {
    const next = moveModCursor(controls, cursor, delta)
    setCursor(next)
    if (next) document.getElementById(controlId(next))?.focus()
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
        if (cursor?.kind === "button") press(cursor)
        return true
      default:
        return false
    }
  })

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={`${PAGE_SCROLL} ${MODS_PAGE}`} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{copy.title}</h1>
        <span className={`keys-only touch:empty:hidden! text-muted ${pgHintClass(false)}`}>{copy.keys}</span>
      </div>
      {panes.length === 0 ? (
        <div className={MODS_EMPTY}>
          <p>{copy.empty}</p>
          <p className="text-muted">{copy.emptyHint}</p>
        </div>
      ) : (
        panes.map((pane) => (
          <section className={MOD_PANE} key={`${pane.plugin}/${pane.id}`}>
            <header className={MOD_PANE_TITLE}>
              {pane.title} <span className="text-muted">{pane.plugin}</span>
            </header>
            <ModTree
              node={pane.tree}
              pane={pane}
              cursor={cursor}
              onPress={press}
              onSubmit={submit}
              onFocus={setCursor}
            />
          </section>
        ))
      )}
    </div>
  )
}
