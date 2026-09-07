/**
 * Framework-free data half of the `kobe ops --preview <rel>` window,
 * extracted from `tui/ops/host.tsx` so the Solid and React previews (issue
 * #15, G3) share it. Vitest-safe: no @opentui imports (the theme-bound
 * SyntaxStyle builder lives in `./preview-syntax`), no framework.
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
 * What a patch expressed entirely in its preamble changed. Binary, mode,
 * rename and empty-file changes are real patches with no hunks — and `<diff>` draws hunk rows and nothing else, so
 * without this they render as a blank pane, which is indistinguishable from
 * "nothing changed": the one thing the patch proves false.
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
  /** git itself refused. Carries git's stderr so the pane can name the
   *  failure instead of presenting an absent diff as an absence of changes. */
  | { readonly kind: "error"; readonly message: string }
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

/** One file's slice of a multi-file unified diff. */
export interface UnifiedDiffFile {
  /** The new-side path from the patch, decoded, for the section label. */
  readonly path: string
  /** That file's complete patch, parseable on its own. */
  readonly text: string
  /** Rendered rows the hunks occupy — `@@` headers are not drawn, so this is
   *  the count of context/added/removed lines. The view needs it because a
   *  `<diff>` inside a scroll container has no intrinsic height. */
  readonly lines: number
  /** Set when the patch has no hunks: what it changed, so the section states
   *  it instead of rendering a label over zero rows. */
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
  // git appends a TAB after the path when it needed quoting or holds a space.
  // The tab always follows the closing quote, so cutting at it is safe.
  const raw = field.replace(/\t[\s\S]*$/, "")
  if (raw === "/dev/null") return null
  const path = unquoteGitPath(raw)
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

/**
 * The b-side path of a `diff --git a/X b/Y` header.
 *
 * git C-quotes a path holding any non-ASCII byte, so a Chinese filename's
 * header reads `diff --git "a/…" "b/…"` — there is no ` b/` in it to split
 * on, which is what left the label showing raw octal escapes and both sides
 * at once. Spaces, by contrast, are NOT quoted, so an unquoted header is
 * genuinely ambiguous by scanning; the split whose two sides name the same
 * file resolves it for everything except a rename.
 */
function headerPath(header: string): string {
  // A quoted a-side: `unquoteGitPath` decodes exactly the first field and
  // stops at its closing quote. The two sides agree except on a rename, and
  // a header is only consulted for patches that have no `+++` line at all —
  // binary and mode-only, neither of which can be a rename.
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
 * Split a multi-file unified diff into one patch per file.
 *
 * Needed because opentui's `DiffRenderable` keeps only the FIRST file: its
 * parser returns every patch (`parsePatch` → a list) and the renderable then
 * does `this._parsedDiff = patches[0]`. So a directory's diff handed over
 * whole renders one file and silently drops the rest — which is the entire
 * point of a combined diff. The view stacks one `<diff>` per entry instead.
 */
export function unifiedDiffFiles(text: string): UnifiedDiffFile[] {
  const files: UnifiedDiffFile[] = []
  let current: { path: string; lines: string[]; rows: number; plus?: string; minus?: string } | null = null
  const push = () => {
    if (!current) return
    const patch = `${current.lines.join("\n")}\n`
    // Prefer the `+++`/`---` lines: one field to end-of-line, so they carry a
    // path with a space unambiguously where the `diff --git` header cannot.
    // A deletion's `+++` is `/dev/null`, so its own `---` side is the label.
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
    // Hunk bodies only: `@@` headers and the `---`/`+++`/`index` preamble are
    // not rendered as rows.
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
 *
 * Restricting `git diff` to the new path alone removes the old path from the
 * comparison, so git cannot pair the two and reports the whole file as added
 * — 60 solid green lines where the row beside it correctly says `+1 −1`, and
 * where the combined diff of the same commit shows the one-line change. The
 * pairing survives only in an UNRESTRICTED `--name-status`, which is where
 * the old path comes from.
 *
 * Returns `null` when this is not an unpaired rename — every ordinary add
 * pays one metadata-only git call and takes this exit.
 */
async function pairRename(
  worktree: string,
  spec: string,
  relPath: string,
): Promise<{ text: string; origPath: string } | null> {
  // `-z` keeps the fields NUL-separated and the paths raw, so a non-ASCII or
  // spaced path needs no unquoting here.
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
 *
 * A git that REFUSES the BASE is never one of those outcomes. A bad base — a
 * pruned remote, a renamed base branch — used to collapse into an empty diff
 * and then be presented as the file's current content or as `no changes in
 * src/`, both of which state as fact something git never said.
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
