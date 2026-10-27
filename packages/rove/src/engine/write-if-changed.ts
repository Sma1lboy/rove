import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Write `content` only when it differs, so a reinstall on every launch leaves
 * the file's mtime alone — a rewrite per launch would make every watcher
 * re-read a file whose bytes never changed. Best-effort: never blocks launch.
 */
export async function writeIfChanged(file: string, content: string): Promise<void> {
  try {
    const current = await readFile(file, "utf8").catch(() => undefined)
    if (current === content) return
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  } catch {
    /* best-effort — never block launch */
  }
}
