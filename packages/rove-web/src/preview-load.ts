/** What the diff view draws from a `diff.file` reply, and how it words a bridge refusal. */

import { BridgeRequestError } from "./bridge.ts"
import { type DiffRow, codeRows, parseUnifiedDiff } from "./diff.ts"
import { t } from "./i18n/index.ts"

export type Loaded =
  | { readonly kind: "rows"; readonly rows: DiffRow[]; readonly diff: boolean }
  | { readonly kind: "text"; readonly text: string; readonly error?: boolean }

/** `diff.file` result (`PreviewData`, `tui/ops/preview-core.ts`) → what this view draws. */
export function load(data: unknown, path: string, foreignBase: boolean): Loaded {
  if (!data || typeof data !== "object" || !("kind" in data)) return { kind: "text", text: t("preview.unknown") }
  const text = "text" in data && typeof data.text === "string" ? data.text : ""
  switch (data.kind) {
    case "diff":
      return { kind: "rows", rows: parseUnifiedDiff(text, path === "." ? null : path, foreignBase), diff: true }
    case "code":
      return { kind: "rows", rows: codeRows(text, path), diff: false }
    case "binary":
      return { kind: "text", text: t("preview.binary") }
    case "empty":
      return { kind: "text", text: t("preview.empty") }
    case "error":
      return { kind: "text", text: "message" in data ? String(data.message) : t("preview.unknown"), error: true }
    default:
      return { kind: "text", text: t("preview.noHunks", { kind: String(data.kind) }) }
  }
}

/** A bridge older than the page has no `review.edit`: say so rather than print `unknown op`. */
export function bridgeError(err: unknown): Error {
  return err instanceof BridgeRequestError && err.code === "UNKNOWN_OP"
    ? new Error(t("review.notSupported"))
    : err instanceof Error
      ? err
      : new Error(String(err))
}
