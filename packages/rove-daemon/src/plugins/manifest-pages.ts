/**
 * `[[pages]]`: React pages the TUI renders in its content pane, listed on the
 * sidebar rail (docs/PLUGIN-AUTHORING.md § Pages). The TUI owns loading; this
 * only validates the table.
 */

import { isAbsolute, normalize, sep } from "node:path"
import { asString, asTableArray, fail } from "./manifest-coerce.ts"

export interface PluginPage {
  /** Local id (no dots); the page's rail id is `<plugin>.<id>`. */
  readonly id: string
  /** Rail label. */
  readonly title: string
  /** Module path inside the plugin; its default export is the page factory. */
  readonly entry: string
  /** Rail position, ascending; the built-in pages sit at 10, 20 and 30. */
  readonly order: number
  /** A page-open keymap action (`kanban.open`, …) whose chord opens this page. */
  readonly action?: string
}

const DEFAULT_PAGE_ORDER = 100

function insidePlugin(entry: string): boolean {
  if (isAbsolute(entry)) return false
  const first = normalize(entry).split(/[\\/]/)[0]
  return first !== ".." && !normalize(entry).startsWith(`..${sep}`)
}

export function parsePages(raw: unknown, localId: RegExp): PluginPage[] {
  const pages = asTableArray(raw, "pages").map((t, i) => {
    const id = asString(t.id, `pages[${i}].id`)
    if (!localId.test(id)) fail(`page id \`${id}\` may not contain dots`)
    const entry = asString(t.entry, `pages[${i}].entry`)
    if (!insidePlugin(entry)) fail(`page \`${id}\` entry \`${entry}\` must be a path inside the plugin`)
    const order = t.order ?? DEFAULT_PAGE_ORDER
    if (typeof order !== "number" || !Number.isInteger(order)) fail(`\`pages[${i}].order\` must be an integer`)
    const action = t.action === undefined ? undefined : asString(t.action, `pages[${i}].action`)
    return { id, title: asString(t.title, `pages[${i}].title`), entry, order, ...(action ? { action } : {}) }
  })
  const seen = new Set<string>()
  for (const page of pages) {
    if (seen.has(page.id)) fail(`duplicate page id \`${page.id}\``)
    seen.add(page.id)
  }
  return pages
}
