/** @jsxImportSource @opentui/react */
/**
 * The MODEL row every engine-choosing dialog shares (new-task, change-engine):
 * a free-text input — a model is the engine's own spelling, an alias, a full
 * id or a fuzzy pattern, so no closed list can validate it — with the
 * engine's `listModels` as a filtered suggestion list underneath while the
 * row has focus. ↑↓ walk the suggestions and COPY the highlighted id into the
 * input, so what the input shows is exactly what gets pinned; typing filters
 * again from the typed text.
 *
 * One hook + one JSX shell, so the two dialogs cannot drift the way five
 * dialogs once grew three selector grammars. The row renders only for engines
 * that declare `modelArgv` (the caller checks {@link engineAcceptsModel});
 * a list that fails or is absent degrades to the bare input, never hides it —
 * claude lists three aliases and takes any full id.
 */

import { useEffect, useMemo, useState } from "react"
import { type EngineModel, engineEntry } from "../../engine/registry"
import { type PickerWindow, clampCursor, stripNewlines, windowAround } from "../../tui/component/new-task-dialog/state"
import type { VendorId } from "../../types/vendor"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { DialogField, DialogSection } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

/** Same lookup the effort row uses (`engineEntry` on the raw id). */
export function engineAcceptsModel(vendor: VendorId): boolean {
  return engineEntry(vendor).modelArgv !== undefined
}

// One list per vendor per process: pi/omp answer by running a binary, and a
// dialog reopened ten times should not spawn it ten times. A failed list is
// evicted so the next open retries instead of remembering a cold start.
const lists = new Map<VendorId, Promise<readonly EngineModel[]>>()

function modelsFor(vendor: VendorId): Promise<readonly EngineModel[]> | null {
  const list = engineEntry(vendor).listModels
  if (!list) return null
  let pending = lists.get(vendor)
  if (!pending) {
    pending = list().catch((err) => {
      lists.delete(vendor)
      throw err
    })
    lists.set(vendor, pending)
  }
  return pending
}

export function filterModels(models: readonly EngineModel[], query: string): readonly EngineModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.id.toLowerCase().includes(q) || m.label?.toLowerCase().includes(q))
}

export type ModelListStatus = "none" | "loading" | "loaded" | "failed"

export function useModelField(opts: {
  vendor: VendorId
  /** Rows the suggestion list may paint. */
  pickerRows: number
  /** The value to open on, valid for `initialVendor` only — another engine
   *  starts empty (a claude alias pinned on codex would kill its launch). */
  initial?: string
  initialVendor?: VendorId
}) {
  const [query, setQuery] = useState(() => (opts.vendor === opts.initialVendor ? (opts.initial ?? "") : ""))
  const [cursor, setCursor] = useState(-1)
  const [models, setModels] = useState<readonly EngineModel[]>([])
  const [status, setStatus] = useState<ModelListStatus>("none")

  // biome-ignore lint/correctness/useExhaustiveDependencies: the engine is the invalidation key — its list and its seed both change with it.
  useEffect(() => {
    setQuery(opts.vendor === opts.initialVendor ? (opts.initial ?? "") : "")
    setCursor(-1)
    const pending = modelsFor(opts.vendor)
    if (!pending) {
      setModels([])
      setStatus("none")
      return
    }
    let live = true
    setStatus("loading")
    pending.then(
      (list) => {
        if (!live) return
        setModels(list)
        setStatus("loaded")
      },
      () => {
        if (!live) return
        setModels([])
        setStatus("failed")
      },
    )
    return () => {
      live = false
    }
  }, [opts.vendor])

  const suggestions = useMemo(() => filterModels(models, query), [models, query])
  const value = cursor >= 0 ? (suggestions[cursor]?.id ?? query) : query
  const window: PickerWindow = windowAround(
    suggestions.map((m) => m.id),
    Math.max(0, cursor),
    opts.pickerRows,
  )

  function setText(v: string): void {
    setQuery(stripNewlines(v))
    setCursor(-1)
  }
  function moveCursor(delta: 1 | -1): void {
    if (suggestions.length === 0) return
    setCursor((c) => clampCursor(c + delta, suggestions.length))
  }
  function pickAt(absoluteIndex: number): void {
    if (suggestions[absoluteIndex]) setCursor(absoluteIndex)
  }

  return { value, query, cursor, suggestions, window, status, setText, moveCursor, pickAt }
}

export type ModelField = ReturnType<typeof useModelField>

export function ModelSection(props: {
  field: ModelField
  focused: boolean
  hint?: string
  onFocus: () => void
  /** Enter inside the input. */
  onSubmit: () => void
}) {
  const { theme } = useTheme()
  const t = useT()
  const { field } = props
  const rows = field.suggestions
    .slice(field.window.start, field.window.start + field.window.items.length)
    .map((m, i) => ({
      key: `${field.window.start + i}:${m.id}`,
      body: m.id,
      accent: false,
      ...(m.label && m.label !== m.id ? { dim: m.label } : {}),
    }))
  return (
    <>
      <DialogSection
        label={t("tasks.engineModel.label")}
        focused={props.focused}
        hint={props.hint}
        onPress={props.onFocus}
      >
        <DialogField focused={props.focused}>
          <input
            value={field.value}
            placeholder={t("tasks.engineModel.placeholder")}
            focused={props.focused}
            onMouseUp={props.onFocus}
            onInput={(v: string) => field.setText(v)}
            onSubmit={props.onSubmit}
          />
        </DialogField>
      </DialogSection>
      {props.focused && field.status === "loading" ? (
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textMuted} wrapMode="none">
            {t("tasks.engineModel.loading")}
          </text>
        </box>
      ) : null}
      {props.focused && field.window.total > 0 ? (
        <PickerList
          window={field.window}
          cursor={Math.max(0, field.cursor)}
          rows={rows}
          onPick={field.pickAt}
          paddingBottom={1}
        />
      ) : null}
    </>
  )
}
