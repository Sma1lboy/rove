/** One line of the preview's diff or file view: line numbers, sign, code. Inside a `group/preview` that takes focus. */

const KIND_BG: Partial<Record<string, string>> = { add: "bg-diff-added-bg", del: "bg-diff-removed-bg" }
const KIND_INK: Partial<Record<string, string>> = { add: "text-diff-added", del: "text-diff-removed" }

export function diffRowClass(kind: string, o: { readonly cursor: boolean; readonly noted: boolean }): string {
  const bg = o.cursor ? "bg-inset group-focus/preview:bg-accent-soft" : o.noted ? "bg-inset" : (KIND_BG[kind] ?? "")
  const look =
    kind === "file"
      ? "mt-2 border-t-hairline border-line pt-1 font-bold text-ink"
      : kind === "hunk" || kind === "meta"
        ? "text-subtle"
        : ""
  // A phone has no room to scroll sideways through a line: narrower columns, and the code wraps under its own.
  const pointer = kind === "file" || kind === "note" ? "cursor-pointer" : "cursor-default"
  return `relative grid ${pointer} grid-cols-[4ch_4ch_2ch_1fr] gap-x-2 gap-y-0 whitespace-pre px-3 narrow:grid-cols-[3ch_3ch_1ch_1fr] narrow:gap-x-1 narrow:px-1.5 group-data-file/preview:grid-cols-[4ch_1ch_1fr] narrow:group-data-file/preview:grid-cols-[3ch_1ch_1fr] ${bg} ${look}`
}

export const DIFF_GUTTER = "text-right text-subtle"
/** The old-side number column (or its blank on a note row): gone in a file view, which has one number per row. */
export const OLD_GUTTER = `${DIFF_GUTTER} group-data-file/preview:hidden`

/** `changed`: a line of a file view that the working tree changed. */
export const diffSignClass = (kind: string, noted: boolean, changed = false): string =>
  noted ? "text-accent" : changed ? "text-diff-added" : (KIND_INK[kind] ?? "")

export const diffCodeClass = (kind: string): string =>
  `min-w-0 narrow:whitespace-pre-wrap narrow:wrap-anywhere ${KIND_INK[kind] ?? ""}`

/** A note's text under the rows it covers. */
export const DIFF_NOTE_TEXT = "min-w-0 whitespace-pre-wrap wrap-anywhere text-accent"

/** A file header's name and counts, in the code column. */
export const DIFF_FILE_NAME = "flex min-w-0 items-baseline gap-2"
