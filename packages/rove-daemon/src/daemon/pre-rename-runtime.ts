import { basename, dirname, join } from "node:path"

// Only for reattaching pre-rename live hosts and moving their state; delete in the next minor.
const LEGACY_PRE_RENAME_RUNTIME_NAME = "kobe"

export function preRenameStateDir(home: string): string {
  return join(home, `.${LEGACY_PRE_RENAME_RUNTIME_NAME}`)
}

export function preRenameConfigDir(home: string): string {
  return join(home, ".config", LEGACY_PRE_RENAME_RUNTIME_NAME)
}

/** Read-only candidates; new listeners always bind the canonical address. */
export function preRenameRuntimePaths(canonical: string): string[] {
  const name = basename(canonical)
  if (canonical.startsWith("\\\\.\\pipe\\rove-") && canonical.endsWith("-pty")) {
    return [canonical.replace("\\pipe\\rove-", `\\pipe\\${LEGACY_PRE_RENAME_RUNTIME_NAME}-`)]
  }
  if (/^rove(?:-[a-f0-9]{8})?-(?:pty|daemon)(?:-\d+)?\.sock$/.test(name) || name === "rove.sock") {
    return [join(dirname(canonical), name.replace(/^rove/, LEGACY_PRE_RENAME_RUNTIME_NAME))]
  }
  if (["pty.sock", "pty.pid", "daemon.sock", "daemon.pid"].includes(name) && basename(dirname(canonical)) === ".rove") {
    return [join(preRenameStateDir(dirname(dirname(canonical))), name)]
  }
  return []
}
