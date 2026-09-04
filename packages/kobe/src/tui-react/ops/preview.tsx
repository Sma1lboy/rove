/** @jsxImportSource @opentui/react */
/**
 * `kobe ops --preview <rel>`. Data + syntax-style mapping are the shared
 * `tui/ops/preview-core.ts` / `preview-syntax.ts`. Loading follows THE ASYNC
 * CANON (`src/tui-react/history/host.tsx`): `useState` + a dependency-keyed
 * `useEffect` whose stale completions are dropped by an effect-local
 * `disposed` flag. `r` bumps a reload tick: the standalone `rove ops
 * --preview` window really is immutable for its lifetime, but the workspace
 * diff tab is meant to stay open while the engine works (docs/TUI.md), so its
 * hunks go stale under you with no way to ask for the current ones.
 */

import { type DiffRenderable, TextAttributes } from "@opentui/core"
import { useEffect, useMemo, useRef, useState } from "react"
import { execHostForWorktreePath } from "../../exec/resolve"
import { formatBytes } from "../../lib/format-bytes"
import { openWithSystemViewer } from "../../lib/open-external"
import type { DiffReviewApi } from "../../tui/ops/diff-comments"
import {
  type PreviewData,
  filetypeOf,
  isCombinedPathspec,
  loadPreviewData,
  unifiedDiffFiles,
} from "../../tui/ops/preview-core"
import { buildSyntaxStyle } from "../../tui/ops/preview-syntax"
import { worktreeFilePath } from "../../worktree/content"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { useDiffReview } from "./preview-review"

export interface OpsPreviewArgs {
  readonly worktree: string
  readonly relPath: string
  /** Base ref for the vs-base (Branch scope) diff; omitted = diff vs HEAD. */
  readonly base?: string
  /**
   * How q/escape/ctrl+c close the preview. The standalone `kobe ops
   * --preview` entrypoint passes `() => process.exit(0)` (the whole process
   * IS the preview); the in-workspace content tab passes a real closer that
   * removes the tab — same `onClose` seam as `UpdatePage`, so the shared
   * component never hard-exits when it's just one tab in a live TUI.
   */
  readonly onClose?: () => void
  /** Whether this preview has keyboard focus — gates its close chords when
   *  hosted as a tab (a standalone process is always focused). */
  readonly focused?: boolean
  /** Line-anchored review notes (diff kind only) — supplied by the
   *  workspace content-tab host; absent for the standalone entrypoint. */
  readonly review?: DiffReviewApi
}

export function PreviewScreen(props: OpsPreviewArgs) {
  const { theme } = useTheme()
  const t = useT()
  const style = useMemo(() => buildSyntaxStyle(theme), [theme])
  const filetype = filetypeOf(props.relPath)
  // A directory / whole-worktree diff. `.` would render as a bare dot in the
  // header, so it gets a name; everything else IS its own name.
  const combined = isCombinedPathspec(props.relPath)
  const pathspecLabel = props.relPath === "." ? t("ops.preview.allFiles") : props.relPath

  const [data, setData] = useState<PreviewData | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const base = props.base
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a TRIGGER — the effect body doesn't read it.
  useEffect(() => {
    let disposed = false
    void loadPreviewData(props.worktree, props.relPath, base ? { base } : undefined)
      .then((d) => {
        if (!disposed) setData(d)
      })
      .catch(() => {
        // Failure boundary: a failed read (worktree torn
        // down mid-open) leaves the loading placeholder rather than crashing.
      })
    return () => {
      disposed = true
    }
  }, [props.worktree, props.relPath, base, reloadTick])

  // System-open (`o`) only makes sense for a LOCAL worktree — the file the
  // OS viewer would open doesn't exist on this machine for a remote one.
  const canSystemOpen = data?.kind === "binary" && !execHostForWorktreePath(props.worktree).isRemote

  // Review overlay (line-anchored notes) — inert unless the host supplied
  // `review` AND the preview is a diff. Owns its own (PROPOSED) chords.
  const diffRef = useRef<DiffRenderable | null>(null)
  const review = useDiffReview({
    // A combined diff spans files and a note anchors to ONE path, so notes
    // would all file against the directory. Read-only rather than wrong — the
    // footer says so, so the absence reads as a rule.
    review: combined ? undefined : props.review,
    relPath: props.relPath,
    diffText: data?.kind === "diff" ? data.text : null,
    focused: props.focused ?? true,
    diffRef,
  })

  const onClose = props.onClose ?? (() => process.exit(0))
  useBindings(() => ({
    enabled: props.focused ?? true,
    // `o` registers only while the binary card is showing (and local), so it
    // never shadows anything else the rest of the time.
    bindings: [
      ...pageCloseBindings(onClose),
      // `r` matches the Files pane next door, which has refreshed its tree
      // with the same key since it landed.
      { key: "r", cmd: () => setReloadTick((tick) => tick + 1) },
      ...(canSystemOpen
        ? [
            {
              key: "o",
              cmd: () => {
                const abs = worktreeFilePath(props.worktree, props.relPath)
                if (abs) openWithSystemViewer(abs)
              },
            },
          ]
        : []),
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.accent}>{pathspecLabel}</text>
        <text fg={theme.textMuted}>
          {data?.kind === "diff"
            ? base
              ? t("ops.preview.diffVsBase", { base })
              : t("ops.preview.diffVsHead")
            : data?.kind === "binary"
              ? t(data.image ? "ops.preview.image" : "ops.preview.binary")
              : t("ops.preview.file")}
        </text>
        <text fg={theme.textMuted}>{t("ops.preview.closeHint")}</text>
        {combined ? <text fg={theme.textMuted}>{t("ops.preview.notesPerFile")}</text> : null}
      </box>
      <box flexGrow={1}>
        {data == null ? (
          <text fg={theme.textMuted}>{t("ops.preview.loading")}</text>
        ) : data.kind === "empty" ? (
          <box paddingLeft={1} paddingTop={1}>
            <text fg={theme.textMuted}>{t("ops.preview.noChanges", { pathspec: pathspecLabel })}</text>
          </box>
        ) : data.kind === "binary" ? (
          // No portable inline-image path in the terminal (see lib/open-external)
          // — a metadata card + hand-off to the system viewer instead of mojibake.
          <box flexDirection="column" paddingLeft={1} paddingTop={1} gap={1}>
            <text fg={theme.text}>
              {t(data.image ? "ops.preview.image" : "ops.preview.binary")}
              {data.sizeBytes != null ? ` · ${formatBytes(data.sizeBytes)}` : ""}
            </text>
            <text fg={theme.textMuted}>
              {canSystemOpen ? t("ops.preview.openHint") : t("ops.preview.noTextPreview")}
            </text>
          </box>
        ) : data.kind === "diff" && combined ? (
          // One `<diff>` per file: opentui's DiffRenderable renders only the
          // first patch of a multi-file diff, so handing it the whole thing
          // would silently drop every file after the first — which is the one
          // thing a combined diff exists to show. Explicit heights because a
          // `<diff>` has no intrinsic size inside a scroll container.
          <scrollbox
            flexGrow={1}
            backgroundColor={theme.background}
            verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
          >
            {unifiedDiffFiles(data.text).map((file) => (
              <box key={file.path} flexDirection="column" flexShrink={0} paddingBottom={1}>
                <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
                  {file.path}
                </text>
                <box height={file.lines} flexShrink={0}>
                  <diff
                    diff={file.text}
                    view="unified"
                    wrapMode="none"
                    filetype={filetypeOf(file.path)}
                    syntaxStyle={style}
                    showLineNumbers={true}
                  />
                </box>
              </box>
            ))}
          </scrollbox>
        ) : data.kind === "diff" ? (
          // wrapMode "none" pins visual rows to logical diff lines — the
          // review overlay's row↔line mapping depends on it.
          <diff
            ref={(r: DiffRenderable | null) => {
              diffRef.current = r
            }}
            diff={data.text}
            view="unified"
            wrapMode="none"
            filetype={filetype}
            syntaxStyle={style}
            showLineNumbers={true}
          />
        ) : (
          <code content={data.text} filetype={filetype} syntaxStyle={style} />
        )}
      </box>
      {review.footer}
    </box>
  )
}
