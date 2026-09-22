/**
 * Framework-free data half of the `kobe ops --preview <rel>` window.
 * Vitest-safe: no @opentui imports (SyntaxStyle lives in `./preview-syntax`).
 */

import { unquoteGitPath } from "@/lib/git-parsers"
import { readWorktreeFile, runWorktreeGit, worktreeFileSize } from "@/worktree/content"
import { t } from "../i18n"

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

/**
 * What a hunkless patch changed (binary, mode, rename, empty file). `<diff>`
 * draws only hunk rows, so without this they'd render blank, which reads as
 * "nothing changed".
 */
export type PatchNote =
  | { readonly kind: "binary" }
  | { readonly kind: "mode"; readonly from: string; readonly to: string }
  | { readonly kind: "rename"; readonly from: string; readonly to: string }
  | { readonly kind: "empty-file"; readonly change: "added" | "deleted" }

export type PreviewData =
  /** Unified diff → opentui `<diff>`. `origPath` is set when the patch is a
   *  rename, so the header can name the side the file came from. */
  | { readonly kind: "diff"; readonly text: string; readonly origPath?: string }
  /** The file's own content → a plain `<code>` view. */
  | { readonly kind: "code"; readonly text: string }
  /** Image/binary placeholder card — the TUI can't render these as text. */
  | { readonly kind: "binary"; readonly image: boolean; readonly sizeBytes: number | null }
  /** A non-empty patch with no hunks — see {@link PatchNote}. */
  | { readonly kind: "patch-note"; readonly note: PatchNote; readonly sizeBytes: number | null }
  /** git refused; carries its stderr so the pane doesn't present a failure as "no changes". */
  | { readonly kind: "error"; readonly message: string }
  /** A COMBINED diff (directory or whole worktree) with no hunks; unlike a
   *  file there's no content to fall back to, so emptiness is stated. */
  | { readonly kind: "empty" }

/**
 * Whether a pathspec can match MANY files: `.` or a directory. Callers
 * normalise directories with a trailing slash (no file path ends in one), so
 * this is decidable from the string alone.
 */
export function isCombinedPathspec(relPath: string): boolean {
  return relPath === "." || relPath.endsWith("/")
}

/** One file's slice of a multi-file unified diff. */
export interface UnifiedDiffFile {
  /** The new-side path from the patch, decoded, for the section label. */
  readonly path: string
  /** That file's complete patch, parseable on its own. */
  readonly text: string
  /** Context/added/removed line count (`@@` headers aren't drawn). Needed
   *  because a `<diff>` in a scroll container has no intrinsic height. */
  readonly lines: number
  /** Set when the patch has no hunks: what it changed. */
  readonly note?: PatchNote
}

/**
 * Classify a patch git expressed entirely in its preamble. Returns `null`
 * when the patch has hunks and should render as an ordinary diff.
 */
export function hunklessPatchNote(patch: string): PatchNote | null {
  if (/^@@/m.test(patch)) return null
  let binary = false
  let from: string | undefined
  let to: string | undefined
  let renameFrom: string | undefined
  let renameTo: string | undefined
  let emptyChange: "added" | "deleted" | undefined
  for (const line of patch.split("\n")) {
    if (line.startsWith("old mode ")) from = line.slice("old mode ".length).trim()
    else if (line.startsWith("new mode ")) to = line.slice("new mode ".length).trim()
    else if (line.startsWith("rename from ")) renameFrom = unquoteGitPath(line.slice(12))
    else if (line.startsWith("rename to ")) renameTo = unquoteGitPath(line.slice(10))
    else if (line.startsWith("new file mode ")) emptyChange = "added"
    else if (line.startsWith("deleted file mode ")) emptyChange = "deleted"
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true
  }
  if (binary) return { kind: "binary" }
  if (renameFrom != null && renameTo != null) return { kind: "rename", from: renameFrom, to: renameTo }
  if (emptyChange) return { kind: "empty-file", change: emptyChange }
  if (from != null && to != null) return { kind: "mode", from, to }
  return null
}

/** Decode one `--- ` / `+++ ` side into its path. `null` for `/dev/null`. */
function sidePath(field: string): string | null {
  // git appends a TAB after a quoted or spaced path, always after the closing quote.
  const raw = field.replace(/\t[\s\S]*$/, "")
  if (raw === "/dev/null") return null
  const path = unquoteGitPath(raw)
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

/**
 * The b-side path of a `diff --git a/X b/Y` header.
 *
 * git C-quotes any non-ASCII path (`"a/…" "b/…"`, no ` b/` to split on) but
 * not spaces, so an unquoted header is ambiguous; the split whose two sides
 * match resolves it for everything except a rename.
 */
function headerPath(header: string): string {
  // Quoted: `unquoteGitPath` decodes just the first field. Sides differ only
  // on a rename, and the header is only consulted when there's no `+++` line
  // (binary, mode-only), which can't be a rename.
  if (header.startsWith('"')) return sidePath(unquoteGitPath(header)) ?? header
  for (let i = header.indexOf(" b/"); i >= 0; i = header.indexOf(" b/", i + 1)) {
    const a = sidePath(header.slice(0, i))
    const b = sidePath(header.slice(i + 1))
    if (a != null && a === b) return b
  }
  const last = header.lastIndexOf(" b/")
  return (last >= 0 ? sidePath(header.slice(last + 1)) : null) ?? header
}

/**
 * Split a multi-file unified diff into one patch per file. opentui's
 * `DiffRenderable` keeps only `patches[0]`, silently dropping the rest, so the
 * view stacks one `<diff>` per entry.
 */
export function unifiedDiffFiles(text: string): UnifiedDiffFile[] {
  const files: UnifiedDiffFile[] = []
  let current: { path: string; lines: string[]; rows: number; plus?: string; minus?: string } | null = null
  const push = () => {
    if (!current) return
    const patch = `${current.lines.join("\n")}\n`
    // `+++`/`---` carry spaced paths unambiguously, unlike the header. A
    // deletion's `+++` is `/dev/null`, so `---` labels it.
    const path = current.plus ?? current.minus ?? current.path
    const note = hunklessPatchNote(patch)
    files.push({ path, text: patch, lines: current.rows, ...(note ? { note } : {}) })
  }
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      push()
      current = { path: headerPath(line.slice("diff --git ".length)), lines: [line], rows: 0 }
      continue
    }
    if (!current) continue
    current.lines.push(line)
    if (line.startsWith("rename to ")) current.path = unquoteGitPath(line.slice(10))
    else if (line.startsWith("copy to ")) current.path = unquoteGitPath(line.slice(8))
    else if (line.startsWith("+++ ")) current.plus = sidePath(line.slice(4)) ?? undefined
    else if (line.startsWith("--- ")) current.minus = sidePath(line.slice(4)) ?? undefined
    // Hunk bodies only; the preamble and `@@` aren't rendered rows.
    else if (/^[ +-]/.test(line)) current.rows += 1
  }
  push()
  return files
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
 * Re-run a single file's diff with BOTH sides of a rename in the pathspec.
 * Restricted to the new path, git can't pair the rename and reports the whole
 * file as added; the old path comes from an UNRESTRICTED `--name-status`.
 *
 * `null` when not an unpaired rename (costs ordinary adds one metadata call).
 */
async function pairRename(
  worktree: string,
  spec: string,
  relPath: string,
): Promise<{ text: string; origPath: string } | null> {
  // `-z`: NUL-separated raw paths, no unquoting needed.
  const listed = await runWorktreeGit(worktree, ["diff", spec, "--name-status", "--find-renames", "-z"])
  if (listed.status !== 0) return null
  const fields = listed.stdout.split("\u0000")
  for (let i = 0; i < fields.length; i += 1) {
    const code = fields[i]
    if (code == null || !/^[RC]\d*$/.test(code)) continue
    const orig = fields[i + 1]
    const neu = fields[i + 2]
    i += 2
    if (orig == null || neu !== relPath) continue
    const paired = await runWorktreeGit(worktree, ["--literal-pathspecs", "diff", spec, "--", relPath, orig])
    if (paired.status !== 0 || paired.stdout.trim().length === 0) return null
    return { text: paired.stdout, origPath: orig }
  }
  return null
}

/**
 * Diff for `relPath`, otherwise its full content. `range` omitted →
 * uncommitted work (`git diff HEAD`); `{ base }` → `git diff <base>...HEAD`
 * (merge-base, the Changes tab's Branch scope). An empty diff falls back to
 * the file's content.
 *
 * Images (by extension) and null-byte content come back as a `binary` card.
 * A COMBINED pathspec ({@link isCombinedPathspec}) yields one multi-file diff,
 * and `empty` instead of the content fallback. A git refusal of the base
 * (pruned remote, renamed branch) is an `error`, never presented as content
 * or "no changes".
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
  const res = await runWorktreeGit(worktree, ["--literal-pathspecs", "diff", spec, "--", relPath])
  // A standalone file may have no repository or no HEAD yet: fall back to
  // its content. Combined/base comparisons have no such fallback.
  if (res.status !== 0 && (range || isCombinedPathspec(relPath))) {
    const stderr = (res.stderr ?? "").trim()
    return { kind: "error", message: stderr || `git diff ${spec} exited with code ${res.status ?? -1}` }
  }
  let diff = res.status === 0 ? res.stdout : ""
  let origPath: string | undefined
  if (diff.trim().length > 0) {
    if (!isCombinedPathspec(relPath)) {
      // A rename unpaired by the restricted pathspec arrives as a whole-file
      // add, so `new file mode` is the cheap gate on the recovery below.
      if (/^new file mode /m.test(diff)) {
        const paired = await pairRename(worktree, spec, relPath)
        if (paired) {
          diff = paired.text
          origPath = paired.origPath
        }
      }
      const note = hunklessPatchNote(diff)
      if (note) return { kind: "patch-note", note, sizeBytes: await worktreeFileSize(worktree, relPath) }
    }
    return { kind: "diff", text: diff, ...(origPath ? { origPath } : {}) }
  }
  if (isCombinedPathspec(relPath)) return { kind: "empty" }
  const text = await readWorktreeFile(worktree, relPath)
  if (text === null) return { kind: "error", message: t("ops.preview.readFailed", { path: relPath }) }
  if (looksBinaryText(text)) {
    return { kind: "binary", image: false, sizeBytes: await worktreeFileSize(worktree, relPath) }
  }
  return { kind: "code", text }
}
