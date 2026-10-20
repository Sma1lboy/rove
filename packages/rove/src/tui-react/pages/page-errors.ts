/**
 * Why installed plugins' pages failed to mount on the last load. Framework-free
 * so the Settings view model can read it without loading the page host.
 */

import { createStateCell } from "../../lib/external-store"

export interface PluginPageError {
  readonly pluginId: string
  readonly pageId: string
  readonly message: string
}

export const pluginPageErrorState = createStateCell<readonly PluginPageError[]>([], "plugin-page-errors")

export function pluginPageErrors(): readonly PluginPageError[] {
  return pluginPageErrorState.get()
}
