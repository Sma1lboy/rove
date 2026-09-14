/**
 * pi-family adapter capabilities.
 *
 * Neither CLI needs terminal-presentation adjustments, and both read `escape`
 * as "interrupt current work" — verified against the installed binaries on
 * 2026-09-11: pi's own footer prints `escape interrupt` beside `ctrl+c/ctrl+d
 * clear/exit`, and omp's `app.interrupt` default is `escape` while `app.clear`
 * (ctrl+c) and `app.exit` (ctrl+d) are separate actions. Writing ctrl+C here
 * would clear the composer instead of stopping the turn.
 */

import type { EngineCapabilities, EngineIdentity } from "@/types/engine"

export const piCapabilities: EngineCapabilities = { interruptSequence: "\u001b" }
export const ompCapabilities: EngineCapabilities = { interruptSequence: "\u001b" }

export const piIdentity: EngineIdentity = { shortName: "Pi" }
export const ompIdentity: EngineIdentity = { shortName: "OMP" }
