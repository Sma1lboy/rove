/**
 * `enter` in the Ops file tree (`files.open`) opens the file in the user's real
 * editor in an embedded command tab. The read-only `openPreview` has no
 * cursor/insert/save, so shelling out (as lazygit/gitui do) beats writing an
 * editor.
 *
 * Fallback: a missing binary (or empty `custom` with no `$EDITOR`) returns
 * `false` and the caller opens the preview, so `enter` is never dead. Gate on
 * "binary missing", NOT exit code: a `:cq` quit is a real session.
 *
 * nvim/vim diff mode: a PLAIN `<bin> <file>` open of a file that differs from
 * HEAD upgrades to side-by-side diff (HEAD read-only left, live file right).
 * Touches neither the user's config nor the repo. Custom commands with their
 * own flags are never rewritten.
 *
 * Settings come from shared `state.json` via getPersistedString (the Ops host
 * is its own process):
 *   - `editor.kind`          "auto" | "vim" | "nvim" | "nano" | "emacs" |
 *                            "custom"   (default "auto" — see `editor-prefs.ts`)
 *   - `editor.customCommand` e.g. `code -w` / `emacsclient` / `subl -w {file}`
 */

import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { quoteShellArg as shellQuote } from "@/lib/shell-command"
import { recordSpawn } from "@/lib/spawn-profile"
import { getPersistedString } from "@/state/repos"
import {
  AUTO_EDITOR_CANDIDATES,
  EDITOR_CUSTOM_KEY,
  EDITOR_KIND_KEY,
  type EditorKind,
  normalizeEditorKind,
} from "@/tui/lib/editor-prefs"
import { pathSyntax, pathWithin } from "@sma1lboy/rove-daemon/path-identity"

/** Token replaced with the (shell-quoted) file path in a custom command. */
const FILE_PLACEHOLDER = "{file}"
/** Token replaced with the requested line (1 when none was asked for). */
const LINE_PLACEHOLDER = "{line}"

/** Editors that take `+N <file>` to open at line N. */
const PLUS_LINE_EDITORS = new Set(["vi", "vim", "nvim", "nano", "emacs", "emacsclient", "micro", "kak", "mg", "joe"])
/** Editors that take `<file>:N` instead. */
const SUFFIX_LINE_EDITORS = new Set(["hx", "helix"])

/** `atLine` reports whether a requested line made it into `command`. */
export interface EditorCommand {
  readonly bin: string
  readonly command: string
  readonly atLine?: boolean
}

function firstToken(cmd: string): string {
  return cmd.trim().split(/\s+/)[0] ?? ""
}

/**
 * Pure (unit-testable without state.json). `null` = nothing usable (caller →
 * preview).
 *
 * - vim / nvim / nano / emacs → `<bin> '<abs>'`
 * - custom → `customCommand` with `{file}` replaced by the quoted path, or the
 *   path appended when there's no placeholder. Empty custom falls back to
 *   `envEditor` (`$VISUAL` / `$EDITOR`), then `null`.
 *
 * `line` opens at that line: `{line}` in a custom command, else `+N` / `:N`
 * for editors known to take it; any other editor opens the file plain
 * (`atLine: false`).
 */
export function buildEditorCommand(
  kind: EditorKind,
  customCommand: string,
  absPath: string,
  envEditor?: string,
  line?: number,
): EditorCommand | null {
  if (kind === "vim" || kind === "nvim" || kind === "nano" || kind === "emacs") {
    return plainEditorCommand(kind, absPath, line)
  }

  // `custom`, and `auto`'s env path (envEditor as the template).
  const tmpl = (customCommand.trim() || (envEditor ?? "").trim()).trim()
  if (!tmpl) return null
  const bin = firstToken(tmpl)
  if (!bin) return null
  const hasLine = tmpl.includes(LINE_PLACEHOLDER)
  const autoPlusLine = !hasLine && line !== undefined && PLUS_LINE_EDITORS.has(bin.split("/").pop() ?? bin)
  const target = hasLine || autoPlusLine ? { arg: shellQuote(absPath), atLine: true } : fileArg(bin, absPath, line)
  // Insert the option before any `--`; `{file}` remains a single file operand.
  const withOption = autoPlusLine ? `${bin} +${line}${tmpl.slice(bin.length)}` : tmpl
  const withLine = withOption.split(LINE_PLACEHOLDER).join(String(line ?? 1))
  const command = withLine.includes(FILE_PLACEHOLDER)
    ? withLine.split(FILE_PLACEHOLDER).join(target.arg)
    : `${withLine} ${target.arg}`
  return line === undefined ? { bin, command } : { bin, command, atLine: target.atLine }
}

/** `<bin> <file>`, with the line when asked for. */
function plainEditorCommand(bin: string, absPath: string, line?: number): EditorCommand {
  const target = fileArg(bin, absPath, line)
  const command = `${bin} ${target.arg}`
  return line === undefined ? { bin, command } : { bin, command, atLine: target.atLine }
}

/** The quoted path, carrying the line in the form `bin` reads it. */
function fileArg(bin: string, absPath: string, line?: number): { arg: string; atLine: boolean } {
  const file = shellQuote(absPath)
  if (line === undefined) return { arg: file, atLine: false }
  const name = bin.split("/").pop() ?? bin
  if (PLUS_LINE_EDITORS.has(name)) return { arg: `+${line} ${file}`, atLine: true }
  if (SUFFIX_LINE_EDITORS.has(name)) return { arg: `${file}:${line}`, atLine: true }
  return { arg: file, atLine: false }
}

/**
 * Pure: nvim/vim `-d` against HEAD. `sh -c` has no `<(…)`, so the HEAD blob
 * goes to a mktemp file, removed on exit; one sh layer, every path
 * `shellQuote`d here. Cursor parks on the live (right) side. `HEAD:./<rel>`
 * pins the lookup to the worktree cwd. If the blob can't be read (the diff
 * raced away), it opens plain so `enter` still lands in an editor.
 */
export function buildNvimDiffCommand(bin: string, absPath: string, relPath: string): string {
  const file = shellQuote(absPath)
  const head = shellQuote(`HEAD:./${relPath}`)
  return [
    "f=$(mktemp 2>/dev/null)",
    `if [ -n "$f" ] && git show ${head} > "$f" 2>/dev/null; then`,
    `  ${bin} -d "$f" ${file} -c 'setlocal nomodifiable' -c 'wincmd l'; r=$?`,
    "else",
    `  ${bin} ${file}; r=$?`,
    "fi",
    'rm -f "$f" 2>/dev/null; exit $r',
  ].join("\n")
}

/** `null` when `absPath` is outside `worktree` (the diff upgrade is skipped). */
export function relativeToWorktree(worktree: string, absPath: string): string | null {
  return pathWithin(worktree, absPath) || null
}

/**
 * `auto` (default) prefers $VISUAL / $EDITOR, else the first installed of
 * {@link AUTO_EDITOR_CANDIDATES} (nvim → vim → emacs → nano); that probe is
 * why this is async.
 */
export async function resolveEditorCommand(absPath: string, line?: number): Promise<EditorCommand | null> {
  const kind = normalizeEditorKind(getPersistedString(EDITOR_KIND_KEY))
  const custom = getPersistedString(EDITOR_CUSTOM_KEY) ?? ""
  const env = (process.env.VISUAL ?? process.env.EDITOR ?? "").trim()
  if (kind !== "auto") return buildEditorCommand(kind, custom, absPath, env, line)
  if (env) return buildEditorCommand("custom", "", absPath, env, line)
  for (const bin of AUTO_EDITOR_CANDIDATES) {
    if (await binaryAvailable(bin)) return plainEditorCommand(bin, absPath, line)
  }
  return null
}

/** On PATH (or an absolute path)? */
export async function binaryAvailable(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["sh", "-c", `command -v ${shellQuote(bin)} >/dev/null 2>&1`], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

/**
 * Only exit 1 means "has diff": an untracked file (0, no HEAD blob) or a git
 * error opens plain. `GIT_OPTIONAL_LOCKS=0` keeps it lock-free so it never
 * takes `.git/index.lock` and races the engine's commits.
 */
export async function fileHasDiff(worktree: string, relPath: string): Promise<boolean> {
  try {
    recordSpawn("tui.fileHasDiff", ["git", "diff", "--quiet", "HEAD", "--", relPath], worktree)
    const proc = Bun.spawn(["git", "diff", "--quiet", "HEAD", "--", relPath], {
      cwd: worktree,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: readOnlyGitProcessEnv(),
    })
    return (await proc.exited) === 1
  } catch {
    return false
  }
}

/**
 * Resolve + maybe diff-upgrade, without launching. `null` → caller falls back
 * to preview / an external opener. A `line` open is never diff-upgraded: the
 * command no longer matches the plain `<bin> <file>` form.
 */
export async function resolveEditorLaunch(
  worktree: string,
  absPath: string,
  line?: number,
): Promise<{ command: string; label: string; atLine?: boolean } | null> {
  const resolved = await resolveEditorCommand(absPath, line)
  if (!resolved) return null
  if (!(await binaryAvailable(resolved.bin))) return null
  const command = await maybeDiffCommand(resolved, worktree, absPath)
  const label = editorWindowLabel(absPath)
  return resolved.atLine === undefined ? { command, label } : { command, label, atLine: resolved.atLine }
}

/**
 * Only the EXACT `<bin> <file>` form upgrades (explicit, auto-detected, or
 * `$EDITOR=nvim`); a custom `nvim -u … {file}` is a deliberate invocation and
 * is left untouched.
 */
async function maybeDiffCommand(resolved: EditorCommand, worktree: string, absPath: string): Promise<string> {
  const { bin, command } = resolved
  if (bin !== "nvim" && bin !== "vim") return command
  if (command !== `${bin} ${shellQuote(absPath)}`) return command
  const rel = relativeToWorktree(worktree, absPath)
  if (!rel) return command
  if (!(await fileHasDiff(worktree, rel))) return command
  return buildNvimDiffCommand(bin, absPath, rel)
}

export function editorWindowLabel(absPath: string): string {
  const base = pathSyntax(absPath).basename(absPath).trim()
  return base.length > 0 ? base : "edit"
}
