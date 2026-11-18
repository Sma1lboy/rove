import { expect, test } from "bun:test"
import { COLS, ROWS } from "../src/celestial/grid.ts"
import { orbitFrame } from "../src/celestial/orbit.ts"
import { cometFrame, ringsFrame } from "../src/celestial/scenes.ts"

test.each([orbitFrame, cometFrame, ringsFrame])(
  "%p animates and can redraw its still frame on a reused grid",
  (draw) => {
    const grid = new Uint8Array(COLS * ROWS)
    draw(grid, 7)
    const still = grid.slice()
    expect(still.some(Boolean)).toBe(true)
    draw(grid, 9)
    expect(grid).not.toEqual(still)
    draw(grid, 7)
    expect(grid).toEqual(still)
  },
)
