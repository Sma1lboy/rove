/**
 * asciicast v2 recorder for one PTY tab — the film pipeline's capture format.
 *
 * A take records what the PTY SAID (output bytes, resizes) plus storyboard
 * markers, with times relative to the tab's first spawn. The renderer replays
 * that into the same `/harness` xterm, so a cut can be re-timed, re-framed or
 * re-encoded without re-running the take. Spec:
 * https://docs.asciinema.org/manual/asciicast/v2/
 */

/** RIS — a respawned process starts on a fresh terminal, as the live client's
 *  remounted xterm does. */
const RESET = "\x1bc"

/**
 * @param {{ cols: number, rows: number, now?: () => number }} opts
 */
export function createCast({ cols, rows, now = () => performance.now() }) {
  const start = now()
  /** @type {Array<[number, "o" | "r" | "m", string]>} */
  const events = []
  let size = `${cols}x${rows}`
  const at = () => Math.round(now() - start) / 1000

  return {
    output(data) {
      if (data) events.push([at(), "o", data])
    },
    resize(c, r) {
      const next = `${c}x${r}`
      if (next === size) return
      size = next
      events.push([at(), "r", next])
    },
    mark(label) {
      events.push([at(), "m", label])
    },
    respawn(c, r) {
      events.push([at(), "o", RESET])
      this.resize(c, r)
    },
    serialize() {
      const header = JSON.stringify({ version: 2, width: cols, height: rows })
      return `${[header, ...events.map((e) => JSON.stringify(e))].join("\n")}\n`
    },
  }
}
