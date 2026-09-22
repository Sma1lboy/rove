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
import { pathSyntax, pathWithin } from "@sma1lboy/kobe-daemon/path-identity"

/** Token replaced with the (shell-quoted) file path in a custom command. */
const FILE_PLACEHOLDER = "{file}"

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
 */
export function buildEditorCommand(
  kind: EditorKind,
  customCommand: string,
  absPath: string,
  envEditor?: string,
): { bin: string; command: string } | null {
  const file = shellQuote(absPath)
  if (kind === "vim") return { bin: "vim", command: `vim ${file}` }
  if (kind === "nvim") return { bin: "nvim", command: `nvim ${file}` }
  if (kind === "nano") return { bin: "nano", command: `nano ${file}` }
  if (kind === "emacs") return { bin: "emacs", command: `emacs ${file}` }

  // `custom`, and `auto`'s env path (envEditor as the template).
  const tmpl = (customCommand.trim() || (envEditor ?? "").trim()).trim()
  if (!tmpl) return null
  const bin = firstToken(tmpl)
  if (!bin) return null
  const command = tmpl.includes(FILE_PLACEHOLDER) ? tmpl.split(FILE_PLACEHOLDER).join(file) : `${tmpl} ${file}`
  return { bin, command }
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
export async function resolveEditorCommand(absPath: string): Promise<{ bin: string; command: string } | null> {
  const kind = normalizeEditorKind(getPersistedString(EDITOR_KIND_KEY))
  const custom = getPersistedString(EDITOR_CUSTOM_KEY) ?? ""
  const env = (process.env.VISUAL ?? process.env.EDITOR ?? "").trim()
  if (kind !== "auto") return buildEditorCommand(kind, custom, absPath, env)
  if (env) return buildEditorCommand("custom", "", absPath, env)
  const file = shellQuote(absPath)
  for (const bin of AUTO_EDITOR_CANDIDATES) {
    if (await binaryAvailable(bin)) return { bin, command: `${bin} ${file}` }
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

/** Resolve + maybe diff-upgrade, without launching. `null` → caller falls back to preview / an external opener. */
export async function resolveEditorLaunch(
  worktree: string,
  absPath: string,
): Promise<{ command: string; label: string } | null> {
  const resolved = await resolveEditorCommand(absPath)
  if (!resolved) return null
  if (!(await binaryAvailable(resolved.bin))) return null
  const command = await maybeDiffCommand(resolved, worktree, absPath)
  return { command, label: editorWindowLabel(absPath) }
}

/**
 * Only the EXACT `<bin> <file>` form upgrades (explicit, auto-detected, or
 * `$EDITOR=nvim`); a custom `nvim -u … {file}` is a deliberate invocation and
 * is left untouched.
 */
async function maybeDiffCommand(
  resolved: { bin: string; command: string },
  worktree: string,
  absPath: string,
): Promise<string> {
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
