/**
 * Docs and README films.
 *
 *   bun e2e/film.ts take <name>        record the take (live; `hero-serve.ts` must be running)
 *   bun e2e/film.ts render [name…]     render from the committed cast (all films by default)
 *
 * A take is the only step that touches the product, the fixture or engine
 * quota; `render` is deterministic and can be re-run for any cut or encode change.
 */

import type { Film } from "./film/film.ts"
import { render } from "./film/render.ts"
import { take } from "./film/take.ts"
import { kanban } from "./films/kanban.ts"

const FILMS: Record<string, Film> = { kanban }

const [command, ...names] = process.argv.slice(2)
const pick = (name: string): Film => {
  const film = FILMS[name]
  if (!film) throw new Error(`unknown film ${JSON.stringify(name)} — one of: ${Object.keys(FILMS).join(", ")}`)
  return film
}

if (command === "take" && names.length === 1) {
  console.log(await take(pick(names[0] as string)))
} else if (command === "render") {
  for (const film of names.length > 0 ? names.map(pick) : Object.values(FILMS)) await render(film)
} else {
  throw new Error("usage: bun e2e/film.ts take <name> | render [name…]")
}
