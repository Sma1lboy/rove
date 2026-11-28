/**
 * GitHub's file-list order, shared by the TUI Files pane and the web's: directories first, then files, each by
 * plain code-unit comparison (`README.md` before `package.json`, `10` before `2`), not the locale's.
 */
export function compareFileEntries(a: { name: string; dir: boolean }, b: { name: string; dir: boolean }): number {
  if (a.dir !== b.dir) return a.dir ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}
