/**
 * Compact accessibility/interactive element snapshot formatter over raw CDP `Accessibility.getFullAXTree`
 * nodes. Pure logic so ref assignment, `--interactive` filtering, `--root @eN` scoping, and truncation
 * are tested without spawning Electron.
 */

import type { SnapshotNode } from "./browser-protocol"

export interface RawAxValue {
  readonly type?: string
  readonly value?: unknown
}

export interface RawAxProperty {
  readonly name: string
  readonly value?: RawAxValue
}

export interface RawAxNode {
  readonly nodeId: string
  readonly ignored?: boolean
  readonly role?: RawAxValue
  readonly name?: RawAxValue
  readonly value?: RawAxValue
  readonly properties?: readonly RawAxProperty[]
  readonly childIds?: readonly string[]
  readonly backendDOMNodeId?: number
}

export interface BuiltSnapshot {
  readonly nodes: readonly SnapshotNode[]
  /** `@eN` → CDP `backendDOMNodeId`, kept by the tab for subsequent `--root @eN` and `batch` steps. */
  readonly refs: ReadonlyMap<string, number>
  readonly totalNodes: number
  readonly truncated: boolean
  readonly text: string
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
  "summary",
])

/** Roles worth keeping in full snapshots even when non-interactive (structure & readable content). */
const LANDMARK_ROLES = new Set([
  "RootWebArea",
  "heading",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "region",
  "dialog",
  "alertdialog",
  "alert",
  "status",
  "article",
  "list",
  "listitem",
  "table",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "img",
  "StaticText",
  "paragraph",
  "blockquote",
  "code",
])

const SKIP_ROLES = new Set(["InlineTextBox", "LineBreak", "none", "presentation"])

export const DEFAULT_MAX_NODES = 250
export const MAX_NODES_LIMIT = 1000

function stringVal(v: RawAxValue | undefined): string {
  if (!v || v.value === undefined || v.value === null) return ""
  return String(v.value).replace(/\s+/g, " ").trim()
}

function propValue(node: RawAxNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value?.value
}

function isInteractiveRole(role: string, node: RawAxNode, insideEditable: boolean): boolean {
  if (INTERACTIVE_ROLES.has(role)) return true
  // Chromium exposes an unnamed internal `generic` node with editable=plaintext inside every <input>.
  if (insideEditable && (role === "generic" || role === "GenericContainer")) return false
  if (propValue(node, "editable") === "plaintext" || propValue(node, "editable") === "richtext") return true
  return false
}

function isKeptNode(
  role: string,
  name: string,
  value: string,
  interactive: boolean,
  interactiveOnly: boolean,
): boolean {
  if (SKIP_ROLES.has(role)) return false
  if (interactiveOnly) return interactive
  if (interactive) return true
  if (role === "StaticText") return name.length > 0
  if (role === "generic" || role === "GenericContainer") return false
  if (LANDMARK_ROLES.has(role)) return name.length > 0 || value.length > 0 || role === "form" || role === "dialog"
  return name.length > 0
}

function clip(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Format one snapshot node into a single compact line: `  @e4 [button] "Continue" disabled`. */
export function formatSnapshotLine(node: SnapshotNode): string {
  const indent = "  ".repeat(Math.min(node.depth, 10))
  const parts = [`${indent}${node.ref} [${node.role}]`]
  if (node.name) parts.push(JSON.stringify(clip(node.name)))
  if (node.value !== undefined) parts.push(`value=${JSON.stringify(clip(node.value, 80))}`)
  if (node.level !== undefined) parts.push(`level=${node.level}`)
  if (node.checked === true) parts.push("checked")
  else if (node.checked === "mixed") parts.push("checked=mixed")
  if (node.disabled) parts.push("disabled")
  if (node.expanded === true) parts.push("expanded")
  else if (node.expanded === false) parts.push("collapsed")
  if (node.selected) parts.push("selected")
  if (node.focused) parts.push("focused")
  if (node.required) parts.push("required")
  return parts.join(" ")
}

/**
 * Build a compact snapshot from a flat CDP AXTree list.
 * When `rootBackendNodeId` is set (`--root @eN`), traversal starts at the AX node matching that
 * backend DOM node id; returns `null` if the root no longer exists in the live AX tree.
 */
export function buildSnapshot(
  rawNodes: readonly RawAxNode[],
  opts: {
    readonly interactive?: boolean
    readonly rootBackendNodeId?: number
    readonly maxNodes?: number
  } = {},
): BuiltSnapshot | null {
  const byId = new Map<string, RawAxNode>()
  for (const node of rawNodes) byId.set(node.nodeId, node)

  let start: RawAxNode | undefined
  if (opts.rootBackendNodeId !== undefined) {
    start =
      rawNodes.find((n) => n.backendDOMNodeId === opts.rootBackendNodeId && !n.ignored) ??
      rawNodes.find((n) => n.backendDOMNodeId === opts.rootBackendNodeId)
    if (!start) return null
  } else {
    start = rawNodes[0]
  }
  if (!start) return { nodes: [], refs: new Map(), totalNodes: 0, truncated: false, text: "" }

  const interactiveOnly = opts.interactive === true
  const maxNodes = Math.max(1, Math.min(MAX_NODES_LIMIT, opts.maxNodes ?? DEFAULT_MAX_NODES))
  const out: SnapshotNode[] = []
  const refs = new Map<string, number>()
  const visited = new Set<string>()
  let totalNodes = 0
  let truncated = false
  let refCounter = 0

  const walk = (node: RawAxNode, depth: number, insideEditable: boolean): void => {
    if (visited.has(node.nodeId)) return
    visited.add(node.nodeId)
    const role = stringVal(node.role) || "unknown"
    const name = stringVal(node.name)
    const value = stringVal(node.value)
    const interactive = isInteractiveRole(role, node, insideEditable)
    const isEditable =
      insideEditable ||
      role === "textbox" ||
      role === "searchbox" ||
      propValue(node, "editable") === "plaintext" ||
      propValue(node, "editable") === "richtext"
    const keep = !node.ignored && role !== "RootWebArea" && isKeptNode(role, name, value, interactive, interactiveOnly)

    let nextDepth = depth
    if (keep) {
      totalNodes += 1
      if (out.length < maxNodes) {
        const ref = `@e${++refCounter}`
        if (node.backendDOMNodeId !== undefined) refs.set(ref, node.backendDOMNodeId)
        const checkedRaw = propValue(node, "checked")
        const checked =
          checkedRaw === "true" || checkedRaw === true ? true : checkedRaw === "mixed" ? "mixed" : undefined
        const disabled = propValue(node, "disabled") === true ? true : undefined
        const expandedRaw = propValue(node, "expanded")
        const expanded = typeof expandedRaw === "boolean" ? expandedRaw : undefined
        const selected = propValue(node, "selected") === true ? true : undefined
        const focused = propValue(node, "focused") === true ? true : undefined
        const required = propValue(node, "required") === true ? true : undefined
        const levelRaw = propValue(node, "level")
        const level = typeof levelRaw === "number" ? levelRaw : undefined
        out.push({
          ref,
          role,
          name,
          depth,
          interactive,
          ...(value !== "" && value !== name ? { value } : {}),
          ...(checked !== undefined ? { checked } : {}),
          ...(disabled ? { disabled } : {}),
          ...(expanded !== undefined ? { expanded } : {}),
          ...(selected ? { selected } : {}),
          ...(focused ? { focused } : {}),
          ...(required ? { required } : {}),
          ...(level !== undefined ? { level } : {}),
        })
        nextDepth = depth + 1
      } else {
        truncated = true
      }
    }

    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child) walk(child, nextDepth, isEditable)
    }
  }

  walk(start, 0, false)
  return {
    nodes: out,
    refs,
    totalNodes,
    truncated,
    text: out.map(formatSnapshotLine).join("\n"),
  }
}
