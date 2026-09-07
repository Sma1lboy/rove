/** `kobe config`: open kobe's single user config file in your editor. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { kvStatePath } from "../env.ts"
import { missingPosixShellHint, posixShell } from "../lib/posix-shell.ts"
import { binaryAvailable, resolveEditorCommand } from "../tui/lib/editor-launch.ts"
import { activeCliName } from "./rename-compat.ts"

const CLI_NAME = activeCliName()

function printUsage(out: Pick<typeof process.stderr, "write">): void {
  out.write(
    [
      `Usage: ${CLI_NAME} config [--path]`,
      "",
      "Open Rove's user config (state.json — theme, locale, engine + editor prefs)",
      "in your editor. The editor is your configured one (Settings → General →",
      "Editor); left on Auto it is $VISUAL / $EDITOR, else the first of",
      "nvim / vim / emacs / nano.",
      "Rove re-reads the file on its next launch.",
      "",
      "Options:",
      "  --path        Print the config file path and exit (don't open an editor)",
      "  -h, --help    Print this help",
      "",
    ].join("\n"),
  )
}

export async function runConfigSubcommand(argv: readonly string[] = []): Promise<void> {
  if (argv.some((a) => a === "-h" || a === "--help" || a === "help")) {
    printUsage(process.stdout)
    return
  }
  const path = kvStatePath()
  if (argv.some((a) => a === "--path" || a === "path")) {
    console.log(path)
    return
  }
  const unknown = argv.find((a) => a.length > 0)
  if (unknown !== undefined) {
    process.stderr.write(`${CLI_NAME} config: unexpected argument "${unknown}"\n`)
    printUsage(process.stderr)
    process.exit(2)
  }

  // Editors open a missing path as a blank "new file" buffer; seed an empty
  // object so first-run `kobe config` lands on real, valid JSON instead.
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "{}\n")
  }

  const resolved = await resolveEditorCommand(path)
  if (!resolved || !(await binaryAvailable(resolved.bin))) {
    process.stderr.write(
      `${CLI_NAME} config: no editor found — set $EDITOR (or Settings → General → Editor), or edit directly:\n  ${path}\n`,
    )
    // Without a shell the probe above can never pass, so "set $EDITOR" is
    // advice that cannot work — say what actually would.
    const hint = missingPosixShellHint()
    if (hint) process.stderr.write(`\n${hint}`)
    process.exit(1)
  }

  // Inherit stdio so the terminal editor takes over this TTY; exit with its
  // code so `:cq` / a non-zero quit propagates.
  const proc = Bun.spawn([posixShell(), "-c", resolved.command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await proc.exited)
}
