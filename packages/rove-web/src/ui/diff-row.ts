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
  return `relative grid cursor-default grid-cols-[4ch_4ch_2ch_1fr] gap-x-2 gap-y-0 whitespace-pre px-3 narrow:grid-cols-[3ch_3ch_1ch_1fr] narrow:gap-x-1 narrow:px-1.5 ${bg} ${look}`
}

export const DIFF_GUTTER = "text-right text-subtle"

export const diffSignClass = (kind: string, noted: boolean): string => (noted ? "text-accent" : (KIND_INK[kind] ?? ""))

export const diffCodeClass = (kind: string): string =>
  `min-w-0 narrow:whitespace-pre-wrap narrow:wrap-anywhere ${KIND_INK[kind] ?? ""}`
