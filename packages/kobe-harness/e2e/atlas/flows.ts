/**
 * The TUI atlas map — every reachable surface as a list of flows.
 *
 * Split by domain to stay under the file-size cap; this file is the single
 * ordered list the shooter and the contact sheet read.
 */

import type { Flow } from "./flows-shared.ts"
import { FLOWS_NAV } from "./flows-nav.ts"
import { FLOWS_PLAN } from "./flows-plan.ts"
import { FLOWS_WORK } from "./flows-work.ts"

export { ROW } from "./flows-shared.ts"
export type { Flow, Step } from "./flows-shared.ts"

export const FLOWS: readonly Flow[] = [...FLOWS_WORK, ...FLOWS_PLAN, ...FLOWS_NAV]
