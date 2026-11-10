/**
 * A file the agent wrote, drawn instead of its diff: markdown through the page's own renderer (no raw HTML), an
 * image or an SVG as an `<img>` (an SVG is never inlined: it would run), a PDF in the browser's viewer from a blob,
 * and an HTML report in a frame with `sandbox=""`: no scripts, no same-origin, no forms, no popups. Scripts stay off
 * because a report is read, not used, and a page that runs code could act for the user inside the bridge's origin
 * (`allow-scripts` without `allow-same-origin` still lets it fetch and exfiltrate). The bytes come from `file.read`.
 */

import { useEffect, useMemo, useState } from "react"
import { type ArtifactKind, blobType, bytesOf, htmlDocument, textOf } from "./artifact.ts"
import { BridgeRequestError } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import { MarkdownView } from "./markdown-view.tsx"
import type { AppModel } from "./model.ts"
import { fill } from "./pages-kit.ts"
import { LINK, PLACEHOLDER_LINE } from "./ui/text.ts"

interface FileReply {
  readonly size: number
  readonly base64: string
}

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly file: FileReply }
  | { readonly kind: "failed"; readonly text: string }

function failure(err: unknown): string {
  if (err instanceof BridgeRequestError) {
    if (err.code === "TOO_LARGE") {
      const size = err.detail?.size
      return fill(t("artifact.tooLarge"), {
        size: typeof size === "number" ? `${(size / 1_048_576).toFixed(1)} MB` : "5 MB+",
      })
    }
    if (err.code === "NOT_PREVIEWABLE") return t("artifact.notPreviewable")
    if (err.code === "NOT_FOUND") return t("artifact.gone")
  }
  return fill(t("artifact.failed"), { error: err instanceof Error ? err.message : String(err) })
}

/** The file's bytes, read again whenever `changeKey` moves (the agent rewrote its worktree). */
function useFile(model: AppModel, taskId: string, path: string, changeKey: string): Load {
  const [load, setLoad] = useState<Load>({ kind: "loading" })
  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey is a refetch trigger
  useEffect(() => {
    let live = true
    model.client.request<FileReply>("file.read", { taskId, path }).then(
      (file) => live && setLoad({ kind: "ready", file }),
      (err) => live && setLoad({ kind: "failed", text: failure(err) }),
    )
    return () => {
      live = false
    }
  }, [model, taskId, path, changeKey])
  return load
}

/** A blob URL for `base64` as `type`, revoked when it is replaced or the view goes. */
function useBlobUrl(base64: string | null, type: string): string | null {
  const url = useMemo(
    () => (base64 === null ? null : URL.createObjectURL(new Blob([bytesOf(base64)], { type }))),
    [base64, type],
  )
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return url
}

export function ArtifactView({
  model,
  taskId,
  path,
  kind,
  changeKey,
}: { model: AppModel; taskId: string; path: string; kind: ArtifactKind; changeKey: string }) {
  useLocale()
  const load = useFile(model, taskId, path, changeKey)
  const base64 =
    load.kind === "ready" && (kind === "svg" || kind === "image" || kind === "pdf") ? load.file.base64 : null
  const url = useBlobUrl(base64, kind === "md" || kind === "html" ? "" : blobType(kind, path))
  if (load.kind === "loading") return <p className={PLACEHOLDER_LINE}>{t("artifact.loading")}</p>
  if (load.kind === "failed") return <p className={`${PLACEHOLDER_LINE} text-error`}>{load.text}</p>
  if (kind === "md") {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <MarkdownView source={textOf(load.file.base64)} />
      </div>
    )
  }
  if (kind === "html") {
    return (
      <iframe
        title={path}
        sandbox=""
        srcDoc={htmlDocument(textOf(load.file.base64))}
        // A report assumes a light page. `color-scheme: light` alone leaves the canvas transparent (the frame and
        // its document agree), so a report with no background drew black text on the dark panel: paint it white.
        style={{ colorScheme: "light", background: "#fff" }}
        className="min-h-0 w-full flex-1 border-none"
      />
    )
  }
  if (!url) return null
  if (kind === "pdf") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <a className={`${LINK} px-3 py-1 font-mono text-meta`} href={url} target="_blank" rel="noreferrer noopener">
          {t("artifact.open")}
        </a>
        <iframe title={path} src={url} className="min-h-0 w-full flex-1 border-none" />
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <img src={url} alt={path} className="max-w-full" />
    </div>
  )
}
