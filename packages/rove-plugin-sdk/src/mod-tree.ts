/**
 * The element tree a mod draws: plain JSON, no callbacks, no markup. The
 * daemon validates every tree a mod sends and both the TUI and the web render
 * the same validated tree with their own primitives, so the vocabulary here is
 * what EVERY host can draw. A tree that breaks a rule is refused whole, never
 * repaired: a host that guessed would draw something the author never wrote.
 */

/** Semantic role; each host's theme picks the colour. Same set as row tokens. */
export const MOD_TONES = ["info", "success", "warning", "error", "muted"] as const
export type ModTone = (typeof MOD_TONES)[number]

/** Spacing step: terminal cells in the TUI, a fixed px scale in the web. */
export type ModSpace = 0 | 1 | 2 | 3

export interface ModBox {
  readonly type: "box"
  readonly direction?: "row" | "column"
  readonly gap?: ModSpace
  readonly padding?: ModSpace
  readonly border?: boolean
  readonly children: readonly ModNode[]
}

export interface ModText {
  readonly type: "text"
  readonly text: string
  readonly tone?: ModTone
  readonly bold?: boolean
}

export interface ModButton {
  readonly type: "button"
  /** Unique in the tree; a press reaches the mod as this key. */
  readonly key: string
  readonly label: string
  readonly tone?: ModTone
}

/** A one-line text field; Enter submits its text to the mod under `key`. */
export interface ModInput {
  readonly type: "input"
  /** Unique in the tree, shared with buttons. */
  readonly key: string
  readonly placeholder?: string
  /** What the field holds when drawn; a redraw with the same value keeps the user's typing. */
  readonly value?: string
}

export type ModNode = ModBox | ModText | ModButton | ModInput

export const MOD_TREE_MAX_NODES = 400
export const MOD_TREE_MAX_DEPTH = 12
export const MOD_TEXT_MAX = 4000
export const MOD_LABEL_MAX = 40
/** Longest text a client submits from an `input`. */
export const MOD_INPUT_MAX = 4000
export const MOD_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
/** A mod's own pane id; the host scopes it by plugin id. */
export const MOD_PANE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const MOD_TITLE_MAX = 60

export type ModTreeResult =
  | { readonly ok: true; readonly tree: ModNode }
  | { readonly ok: false; readonly error: string }

const ALLOWED: Record<ModNode["type"], ReadonlySet<string>> = {
  box: new Set(["type", "direction", "gap", "padding", "border", "children"]),
  text: new Set(["type", "text", "tone", "bold"]),
  button: new Set(["type", "key", "label", "tone"]),
  input: new Set(["type", "key", "placeholder", "value"]),
}

function isTone(v: unknown): v is ModTone {
  return typeof v === "string" && (MOD_TONES as readonly string[]).includes(v)
}

function isSpace(v: unknown): v is ModSpace {
  return v === 0 || v === 1 || v === 2 || v === 3
}

class Refused extends Error {}

/** Validate and copy a tree (the copy holds only known props). */
export function validateModTree(input: unknown): ModTreeResult {
  let nodes = 0
  const keys = new Set<string>()
  const walk = (raw: unknown, path: string, depth: number): ModNode => {
    if (depth > MOD_TREE_MAX_DEPTH) throw new Refused(`${path}: deeper than ${MOD_TREE_MAX_DEPTH}`)
    if (++nodes > MOD_TREE_MAX_NODES) throw new Refused(`more than ${MOD_TREE_MAX_NODES} elements`)
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Refused(`${path}: not an element`)
    const el = raw as Record<string, unknown>
    const type = el.type
    if (type !== "box" && type !== "text" && type !== "button" && type !== "input") {
      throw new Refused(`${path}: unknown element ${JSON.stringify(type)}`)
    }
    for (const prop of Object.keys(el)) {
      if (!ALLOWED[type].has(prop)) throw new Refused(`${path}: ${type} has no prop "${prop}"`)
    }
    if (el.tone !== undefined && !isTone(el.tone))
      throw new Refused(`${path}: tone must be one of ${MOD_TONES.join(", ")}`)
    if (type === "text") {
      if (typeof el.text !== "string" || el.text.length > MOD_TEXT_MAX) {
        throw new Refused(`${path}: text must be a string of at most ${MOD_TEXT_MAX} chars`)
      }
      if (el.bold !== undefined && typeof el.bold !== "boolean") throw new Refused(`${path}: bold must be boolean`)
      return {
        type,
        text: el.text,
        ...(el.tone !== undefined ? { tone: el.tone as ModTone } : {}),
        ...(el.bold ? { bold: true } : {}),
      }
    }
    if (type === "button" || type === "input") {
      if (typeof el.key !== "string" || !MOD_KEY_PATTERN.test(el.key)) throw new Refused(`${path}: bad ${type} key`)
      if (keys.has(el.key)) throw new Refused(`${path}: duplicate key "${el.key}"`)
      keys.add(el.key)
    }
    if (type === "input") {
      for (const prop of ["placeholder", "value"] as const) {
        const v = el[prop]
        if (v !== undefined && (typeof v !== "string" || v.length > MOD_INPUT_MAX)) {
          throw new Refused(`${path}: ${prop} must be a string of at most ${MOD_INPUT_MAX} chars`)
        }
      }
      return {
        type,
        key: el.key as string,
        ...(el.placeholder !== undefined ? { placeholder: el.placeholder as string } : {}),
        ...(el.value !== undefined ? { value: el.value as string } : {}),
      }
    }
    if (type === "button") {
      if (typeof el.label !== "string" || el.label.length === 0 || el.label.length > MOD_LABEL_MAX) {
        throw new Refused(`${path}: label must be 1-${MOD_LABEL_MAX} chars`)
      }
      return {
        type,
        key: el.key as string,
        label: el.label,
        ...(el.tone !== undefined ? { tone: el.tone as ModTone } : {}),
      }
    }
    if (el.direction !== undefined && el.direction !== "row" && el.direction !== "column") {
      throw new Refused(`${path}: direction must be "row" or "column"`)
    }
    for (const prop of ["gap", "padding"] as const) {
      if (el[prop] !== undefined && !isSpace(el[prop])) throw new Refused(`${path}: ${prop} must be 0-3`)
    }
    if (el.border !== undefined && typeof el.border !== "boolean") throw new Refused(`${path}: border must be boolean`)
    if (!Array.isArray(el.children)) throw new Refused(`${path}: box needs children`)
    return {
      type,
      ...(el.direction !== undefined ? { direction: el.direction as "row" | "column" } : {}),
      ...(el.gap !== undefined ? { gap: el.gap as ModSpace } : {}),
      ...(el.padding !== undefined ? { padding: el.padding as ModSpace } : {}),
      ...(el.border ? { border: true } : {}),
      children: el.children.map((child, i) => walk(child, `${path}.children[${i}]`, depth + 1)),
    }
  }
  try {
    return { ok: true, tree: walk(input, "tree", 1) }
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message }
    throw err
  }
}

/** One open mod pane, as the `mod.ui` channel carries it. */
export interface ModPaneView {
  /** Owning plugin id. */
  readonly plugin: string
  /** The mod's own pane id. */
  readonly id: string
  readonly title: string
  readonly tree: ModNode
}

/** Parse a `mod.ui` payload, re-validating every tree (a client trusts no publisher). */
export function parseModUiPayload(payload: unknown): readonly ModPaneView[] | null {
  const panes = (payload as { panes?: unknown } | undefined)?.panes
  if (!Array.isArray(panes)) return null
  const out: ModPaneView[] = []
  for (const raw of panes) {
    if (!raw || typeof raw !== "object") continue
    const p = raw as Record<string, unknown>
    if (typeof p.plugin !== "string" || typeof p.id !== "string" || typeof p.title !== "string") continue
    const tree = validateModTree(p.tree)
    if (tree.ok) out.push({ plugin: p.plugin, id: p.id, title: p.title, tree: tree.tree })
  }
  return out
}
