/** @jsxImportSource @opentui/react */
/**
 * The Mods page, as the `mods` page source: present on the rail only while
 * some mod has a pane open (an empty page is not a destination), so a user
 * with no mods sees the rail unchanged.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { t } from "../../tui/i18n"
import { ModsPage } from "../component/mods-page"
import { type PageEntry, type PageProps, setPageSource } from "./registry"

function ModsRailPage(props: PageProps) {
  return <ModsPage orchestrator={props.orchestrator} focused={props.focused} onClose={props.onClose} />
}

export const MODS_PAGE: PageEntry = {
  id: "mods",
  title: () => t("mods.title"),
  // After the built-in pages (10/20/30); plugin `[[pages]]` choose their own.
  order: 90,
  component: ModsRailPage,
}

/** Keep the rail's Mods row in step with `mod.ui`; returns the unsubscribe. */
export function registerModsPage(orchestrator: RemoteOrchestrator): () => void {
  const panes = orchestrator.modPanesSignal()
  let shown: boolean | null = null
  const apply = (): void => {
    const next = panes.get().length > 0
    if (next === shown) return
    shown = next
    setPageSource("mods", next ? [MODS_PAGE] : [])
  }
  apply()
  return panes.subscribe(apply)
}
