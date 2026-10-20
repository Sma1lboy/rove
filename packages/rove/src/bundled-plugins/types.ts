/**
 * A plugin compiled into Rove: the same page factory an installed plugin's
 * `[[pages]]` module exports, with its manifest as data. It reaches the host
 * only through the `PageHost` its factory receives.
 */

import type { PageHost } from "../tui-react/pages/host-api"
import type { PageComponent } from "../tui-react/pages/registry"
import type { PageAction } from "../tui/panes/sidebar/nav-core"

export interface BundledPage {
  readonly id: string
  /** Read at render; `host.i18n.t` follows the UI language. */
  readonly title: (host: PageHost) => string
  readonly order: number
  readonly action?: PageAction
  readonly factory: (host: PageHost) => PageComponent
}

export interface BundledPlugin {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly pages: readonly BundledPage[]
}
