/** The Machines page: one block per registered machine, and the rail entry's trouble count. */

export const MACHINE_ROW = "flex flex-col gap-1 border-line border-b-hairline px-0.5 py-2 last:border-b-0"
export const MACHINE_HEAD = "flex min-w-0 items-baseline gap-2.5"
export const MACHINE_NAME = "min-w-0 truncate font-bold"
export const MACHINE_META = "ml-auto whitespace-nowrap text-meta text-muted"
export const MACHINE_REASON = "m-0 text-meta leading-[inherit]"
export const MACHINE_FIX = "m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-meta text-muted"
export const MACHINE_CMD = "select-all rounded-xs bg-inset px-1.5 py-0.5 font-mono text-ink"
/** The rail's Machines entry: how many are not connected, right-aligned where New task has its +. */
export const RAIL_NAV_TROUBLE = "ml-auto font-mono text-meta text-warning normal-nums"
