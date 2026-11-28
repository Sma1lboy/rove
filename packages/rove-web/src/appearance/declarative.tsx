/**
 * Slot dispatcher (`AppearanceSlot`) and declarative renderers:
 *  - Custom component (`slots.<id>.component`) loaded from the bridge bundle
 *  - Declarative `ModNode` tree (`slots.<id>.tree`) with `{{field}}` plain-text interpolation
 *  - Declarative field-list / surface / variant rendering (`fields`, `secondaryFields`, `surface`, `variant`)
 * Every customized slot runs inside its own `SlotErrorBoundary` so a failure
 * falls back only that slot to `fallback`.
 */

import {
  type AppearanceSlotId,
  type AppearanceSlotSpec,
  type SlotDataMap,
  interpolateSlotTemplate,
} from "@sma1lboy/rove-client/appearance/index.ts"
import type { ModNode } from "@sma1lboy/rove-core/lib/mods-core.ts"
import type { CSSProperties, ReactNode } from "react"
import { useStore } from "../store.ts"
import { useMode } from "../task-colors.ts"
import {
  AP_DECL_PILL,
  AP_DECL_PRIMARY,
  AP_DECL_ROW_BASE,
  AP_DECL_SECONDARY,
  AP_PANEL_HEADER,
  AP_PANEL_SUMMARY,
  AP_STATUS_BAR,
  apDensityRowClass,
  apSlotSurfaceClass,
  apSlotVariantClass,
} from "../ui/appearance.ts"
import { Button } from "../ui/button.tsx"
import { modBoxClass, modTextClass } from "../ui/mods.ts"
import { SlotErrorBoundary } from "./boundaries.tsx"
import {
  type AppearanceSlotComponentProps,
  appearanceTokensStore,
  useActiveAppearancePack,
  useAppearance,
} from "./runtime.ts"

const SPACE_PX = [0, 4, 8, 14] as const

function flattenFields<K extends AppearanceSlotId>(
  slot: K,
  data: SlotDataMap[K],
): Record<string, string | number | boolean | null | undefined> {
  if (slot === "rail.row") {
    const d = data as SlotDataMap["rail.row"]
    return {
      title: d.title,
      branch: d.branch ?? "",
      repo: d.repo ?? "",
      engine: d.engineName ?? d.engineId ?? "",
      status: d.statusKind,
      statusLabel: d.statusLabel,
      pr: d.pr ? `#${d.pr.number} ${d.pr.state}` : "",
      todos: d.todos ? `${d.todos.done}/${d.todos.total}` : "",
      tokens: d.tokens?.map((t) => t.text).join(" · ") ?? "",
      age: d.age ?? "",
      cloud: d.cloud ?? "",
      pinned: d.pinned ? "pinned" : "",
      diffStats: d.diffStats ? `+${d.diffStats.added} -${d.diffStats.removed}` : "",
      cost: d.cost ?? "",
    }
  }
  if (slot === "rail.groupHeader") {
    const d = data as SlotDataMap["rail.groupHeader"]
    return { label: d.label, repo: d.repo ?? "", count: d.count, collapsed: d.collapsed, kind: d.kind }
  }
  if (slot === "rail.footer") {
    const d = data as SlotDataMap["rail.footer"]
    return { usageSummary: d.usageSummary, settingsLabel: d.settingsLabel, unreadCount: d.unreadCount }
  }
  if (slot === "session.header") {
    const d = data as SlotDataMap["session.header"]
    return {
      title: d.title,
      branch: d.branch ?? "",
      repo: d.repo ?? "",
      engine: d.engineName ?? d.engineId ?? "",
      status: d.statusKind,
      tabCount: d.tabCount,
      activeTab: d.activeTab ?? "",
    }
  }
  if (slot === "panel.tabs") {
    const d = data as SlotDataMap["panel.tabs"]
    return { kind: d.kind, title: d.title, hint: d.hint, tabCount: d.tabCount, expanded: d.expanded }
  }
  if (slot === "panel.section") {
    const d = data as SlotDataMap["panel.section"]
    return {
      kind: d.kind,
      title: d.title,
      branch: d.branch ?? "",
      repo: d.repo ?? "",
      engine: d.engineName ?? d.engineId ?? "",
      status: d.statusKind,
      diffStats: d.diffStats ? `+${d.diffStats.added} -${d.diffStats.removed}` : "",
      todos: d.todos ? `${d.todos.done}/${d.todos.total}` : "",
      pr: d.pr ? `#${d.pr.number}` : "",
      cost: d.cost ?? "",
    }
  }
  if (slot === "status.bar") {
    const d = data as SlotDataMap["status.bar"]
    return {
      connection: d.connection,
      taskTitle: d.taskTitle ?? "",
      branch: d.branch ?? "",
      engine: d.engineName ?? "",
      status: d.statusKind ?? "",
      diffStats: d.diffStats ? `+${d.diffStats.added} -${d.diffStats.removed}` : "",
      usageSummary: d.usageSummary,
    }
  }
  return data as unknown as Record<string, string | number | boolean | null | undefined>
}

function DeclarativeTree({
  node,
  values,
  onAction,
}: {
  readonly node: ModNode
  readonly values: Readonly<Record<string, string | number | boolean | null | undefined>>
  readonly onAction?: (key: string) => void
}): ReactNode {
  if (node.type === "text") {
    const text = interpolateSlotTemplate(node.text, values)
    if (!text) return null
    return <span className={modTextClass(node.tone, node.bold === true)}>{text}</span>
  }
  if (node.type === "button") {
    return (
      <Button variant="action" onClick={() => onAction?.(node.key)}>
        {interpolateSlotTemplate(node.label, values)}
      </Button>
    )
  }
  if (node.type === "input") return null
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
        // biome-ignore lint/suspicious/noArrayIndexKey: positional identity inside declarative tree
        <DeclarativeTree key={i} node={child} values={values} onAction={onAction} />
      ))}
    </div>
  )
}

function renderDeclarativeSlot<K extends AppearanceSlotId>(
  slot: K,
  spec: AppearanceSlotSpec,
  data: SlotDataMap[K],
  defaultNode: ReactNode,
  density: "compact" | "comfortable" | "spacious" | undefined,
): ReactNode {
  const values = flattenFields(slot, data)

  if (spec.tree) {
    const onAction = (key: string) => {
      if (slot === "rail.row" && key === "select") (data as SlotDataMap["rail.row"]).onSelect()
      if (slot === "rail.groupHeader" && key === "toggle") (data as SlotDataMap["rail.groupHeader"]).onToggle()
      if (slot === "rail.groupHeader" && key === "newTask") (data as SlotDataMap["rail.groupHeader"]).onNewTask?.()
      if (slot === "rail.footer" && key === "settings") (data as SlotDataMap["rail.footer"]).onOpenSettings()
      if (slot === "rail.footer" && key === "inbox") (data as SlotDataMap["rail.footer"]).onOpenInbox()
      if (slot === "panel.tabs" && key === "close") (data as SlotDataMap["panel.tabs"]).onClose()
      if (slot === "panel.tabs" && key === "expand") (data as SlotDataMap["panel.tabs"]).onToggleExpand?.()
      if (slot === "status.bar" && key === "retry") (data as SlotDataMap["status.bar"]).onRetry()
    }
    return <DeclarativeTree node={spec.tree} values={values} onAction={onAction} />
  }

  if (slot === "rail.row" && (spec.fields || spec.secondaryFields || spec.surface || spec.variant)) {
    const row = data as SlotDataMap["rail.row"]
    const primary = spec.fields ?? ["title", "pr", "statusLabel"]
    const secondary = spec.secondaryFields ?? []
    const style = row.engineColor ? ({ "--ap-engine-color": row.engineColor } as CSSProperties) : undefined
    return (
      <Button
        variant="row"
        className={`${AP_DECL_ROW_BASE} ${apDensityRowClass(density)} ${apSlotSurfaceClass(spec.surface, row.selected)} ${apSlotVariantClass(spec.variant)}`}
        style={style}
        onClick={row.onSelect}
        data-ap-slot="rail.row"
      >
        <span className={AP_DECL_PRIMARY}>
          {primary.map((field) => {
            const val = values[field]
            if (!val) return null
            if (field === "title")
              return (
                <span key={field} className="min-w-0 flex-1 truncate font-medium">
                  {String(val)}
                </span>
              )
            return (
              <span key={field} className={AP_DECL_PILL}>
                {String(val)}
              </span>
            )
          })}
        </span>
        {secondary.length > 0 && (
          <span className={AP_DECL_SECONDARY}>
            {secondary.map((field) => {
              const val = values[field]
              if (!val) return null
              return (
                <span key={field} className="truncate">
                  {String(val)}
                </span>
              )
            })}
          </span>
        )}
      </Button>
    )
  }

  if (slot === "panel.section" && (spec.fields || spec.secondaryFields)) {
    const fields = [...(spec.fields ?? []), ...(spec.secondaryFields ?? [])]
    const items = fields.map((f) => [f, values[f]] as const).filter(([, v]) => Boolean(v))
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-ap-slot="panel.section">
        {items.length > 0 && (
          <div className={AP_PANEL_SUMMARY}>
            {items.map(([k, v]) => (
              <span key={k} className={AP_DECL_PILL}>
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}
        {defaultNode}
      </div>
    )
  }

  if (slot === "panel.tabs" && (spec.fields || spec.surface || spec.variant)) {
    const d = data as SlotDataMap["panel.tabs"]
    const fields = spec.fields ?? ["title"]
    return (
      <div className={AP_PANEL_HEADER} data-ap-slot="panel.tabs">
        <span className="flex min-w-0 items-center gap-2 truncate">
          {fields.map((f) => (values[f] ? <span key={f}>{String(values[f])}</span> : null))}
        </span>
        <Button variant="action" onClick={d.onClose}>
          ×
        </Button>
      </div>
    )
  }

  if (slot === "status.bar" && (spec.fields || spec.secondaryFields)) {
    const fields = [...(spec.fields ?? []), ...(spec.secondaryFields ?? [])]
    const items = fields.map((f) => [f, values[f]] as const).filter(([, v]) => Boolean(v))
    if (items.length === 0) return defaultNode
    return (
      <footer className={AP_STATUS_BAR} data-ap-slot="status.bar">
        {items.map(([k, v]) => (
          <span key={k} className="truncate">
            {String(v)}
          </span>
        ))}
      </footer>
    )
  }

  return defaultNode
}

/**
 * Renders an appearance-pack slot if the active pack customizes it (via custom
 * component, declarative tree, or field list), wrapped in a per-slot
 * `SlotErrorBoundary` that falls back to `fallback` on any throw.
 */
export function AppearanceSlot<K extends AppearanceSlotId>({
  slot,
  data,
  fallback,
}: {
  readonly slot: K
  readonly data: SlotDataMap[K]
  readonly fallback: ReactNode
}): ReactNode {
  const state = useAppearance()
  const pack = useActiveAppearancePack()
  const mode = useMode()
  const tokens = useStore(appearanceTokensStore)

  if (!pack) return fallback
  const spec = pack.manifest.slots?.[slot]
  if (!spec) return fallback
  if (spec.hidden) return null

  const CustomComp = state.slotComponents[slot] as React.ComponentType<AppearanceSlotComponentProps<K>> | undefined
  const boundaryKey = `${pack.id}:${pack.fingerprint}:${slot}`

  if (CustomComp) {
    return (
      <SlotErrorBoundary key={boundaryKey} packId={pack.id} slot={slot} file={spec.component} fallback={fallback}>
        <CustomComp slot={slot} data={data} defaultNode={fallback} spec={spec} tokens={tokens} mode={mode}>
          {fallback}
        </CustomComp>
      </SlotErrorBoundary>
    )
  }

  if (spec.tree || spec.fields || spec.secondaryFields || spec.surface || spec.variant) {
    return (
      <SlotErrorBoundary key={boundaryKey} packId={pack.id} slot={slot} file="appearance.json" fallback={fallback}>
        {renderDeclarativeSlot(slot, spec, data, fallback, pack.manifest.layout?.density)}
      </SlotErrorBoundary>
    )
  }

  return fallback
}
