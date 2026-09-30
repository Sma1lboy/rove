/**
 * Docs and README films.
 *
 *   bun e2e/film.ts take <name>        record the take (live; `hero-serve.ts` must be running)
 *   bun e2e/film.ts render [name…]     render from the committed cast (every film that has one by default)
 *
 * A take is the only step that touches the product, the fixture or engine
 * quota; `render` is deterministic and can be re-run for any cut or encode change.
 */

import { existsSync } from "node:fs"
import { castPath, type Film } from "./film/film.ts"
import { render } from "./film/render.ts"
import { take } from "./film/take.ts"
import { autoRouting, prepareAutoRouting } from "./films/auto-routing.ts"
import { contribEngine } from "./films/contrib-engine.ts"
import { helloEvents } from "./films/hello-events.ts"
import { kanban } from "./films/kanban.ts"
import { routines } from "./films/routines.ts"
import { settingsDemo } from "./films/settings-demo.ts"
import { taskBoard } from "./films/task-board.ts"
import { turnNotify } from "./films/turn-notify.ts"

const FILMS: Record<string, Film> = {
  kanban,
  routines,
  "task-board": taskBoard,
  "contrib-engine": contribEngine,
  "settings-demo": settingsDemo,
  "hello-events": helloEvents,
  "turn-notify": turnNotify,
  "auto-routing": autoRouting,
}

/** Fixture work a film needs done BEFORE the TUI boots, because the TUI reads
 *  it once at start. Runs ahead of `take`, never ahead of `render`. */
const PREPARE: Record<string, () => Promise<void>> = { "auto-routing": prepareAutoRouting }

const [command, ...names] = process.argv.slice(2)
const pick = (name: string): Film => {
  const film = FILMS[name]
  if (!film) throw new Error(`unknown film ${JSON.stringify(name)} — one of: ${Object.keys(FILMS).join(", ")}`)
  return film
}

if (command === "take" && names.length === 1) {
  const film = pick(names[0] as string)
  await PREPARE[film.name]?.()
  console.log(await take(film))
} else if (command === "render") {
  // Explicit names must have a cast (render throws if one is missing). With no
  // names, a film that was never taken is skipped and said so — a real take can
  // cost engine quota, so not every film is expected to have one.
  for (const film of names.length > 0 ? names.map(pick) : Object.values(FILMS)) {
    if (names.length === 0 && !existsSync(castPath(film.name))) {
      console.log(`[film:${film.name}] skipped — no cast (bun e2e/film.ts take ${film.name})`)
      continue
    }
    await render(film)
  }
} else {
  throw new Error("usage: bun e2e/film.ts take <name> | render [name…]")
}
