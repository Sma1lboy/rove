/**
 * Framework-free data half of the `kobe ops --preview <rel>` window,
 * extracted from `tui/ops/host.tsx` so the Solid and React previews (issue
 * #15, G3) share it. Vitest-safe: no @opentui imports (the theme-bound
 * SyntaxStyle builder lives in `./preview-syntax`), no framework.
 */

import { readWorktreeFile, runWorktreeGit, worktreeFileSize } from "@/worktree/content"

/** Map a file extension to an opentui tree-sitter grammar name. */
export function filetypeOf(relPath: string): string | undefined {
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase()
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript"
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript"
    case "md":
    case "markdown":
      return "markdown"
    default:
      return undefined
  }
}

export type PreviewData =
  /** `diff` renders opentui `<diff>` (unified vs HEAD); `code` a plain `<code>` view. */
  | { readonly kind: "diff" | "code"; readonly text: string }
  /** Image/binary placeholder card — the TUI can't render these as text. */
  | { readonly kind: "binary"; readonly image: boolean; readonly sizeBytes: number | null }
  /**
   * A COMBINED diff (a directory, or the whole worktree) that git produced no
   * hunks for. A single file falls back to its own content here, which is the
   * right answer for a file and a blank pane for a pathspec — there is no
   * "content of src/" to show, so the emptiness has to be stated.
   */
  | { readonly kind: "empty" }

/**
 * Whether a pathspec can match MANY files: the whole worktree (`.`) or a
 * directory. Callers that open a directory diff normalise it with a trailing
 * slash, which is what makes this decidable from the string alone — no file
 * path ever ends in one — so the flag never has to be threaded from the tree
 * row through four hand-offs to the loader.
 */
export function isCombinedPathspec(relPath: string): boolean {
  return relPath === "." || relPath.endsWith("/")
}

/** Extensions the preview treats as images (→ binary card, no text read). */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "avif", "heic"])

export function isImagePath(relPath: string): boolean {
  return IMAGE_EXTS.has(relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase())
}

/** Null byte in the head of a utf8-decoded read = not renderable text. */
export function looksBinaryText(text: string): boolean {
  return text.slice(0, 8192).includes("\u0000")
}

/**
 * Diff for `relPath`, otherwise its full content. `range` picks the diff:
 * omitted → uncommitted work (`git diff HEAD`); `{ base }` → everything this
 * branch changed vs its base (`git diff <base>...HEAD`, three-dot = against
 * the merge-base — the Changes tab's Branch scope). Either way, an empty diff
 * falls back to the file's current content.
 *
 * Images (by extension) and files whose content carries null bytes skip the
 * text path entirely and come back as a `binary` card — a PNG rendered as
 * utf8 is mojibake, not a preview.
 *
 * `relPath` is a git pathspec, and a COMBINED one (a directory, or `.` for the
 * whole worktree — see {@link isCombinedPathspec}) is handled the same way up
 * to the fallback: git emits every matching file's hunks in one unified diff,
 * which `<diff>` already renders. Only the EMPTY case differs — reading "the
 * file" back does not mean anything for a directory, so it reports `empty`
 * instead of rendering a blank code view.
 */
export async function loadPreviewData(
  worktree: string,
  relPath: string,
  range?: { base: string },
): Promise<PreviewData> {
  if (isImagePath(relPath)) {
    return { kind: "binary", image: true, sizeBytes: await worktreeFileSize(worktree, relPath) }
  }
  const spec = range ? `${range.base}...HEAD` : "HEAD"
  const res = await runWorktreeGit(worktree, ["diff", spec, "--", relPath])
  const diff = res.status === 0 ? res.stdout : ""
  if (diff.trim().length > 0) return { kind: "diff", text: diff }
  if (isCombinedPathspec(relPath)) return { kind: "empty" }
  const text = (await readWorktreeFile(worktree, relPath)) ?? ""
  if (looksBinaryText(text)) {
    return { kind: "binary", image: false, sizeBytes: await worktreeFileSize(worktree, relPath) }
  }
  return { kind: "code", text }
}
