export const SKY_WIDTH = 760
export const SKY_HEIGHT = 335
export const FLIGHT_SECONDS = 17

function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const random = seededRandom(892671)
export const flock = Array.from({ length: 104 }, (_, index) => ({
  along: random() + random() - 1,
  across: random() + random() - 1,
  depth: random(),
  phase: random() * 2 * Math.PI,
  pace: random(),
  starX: 44 + random() * 672,
  starY: 23 + random() * 284,
  copper: index === 2 || index === 61 || index === 24,
  near: index === 2 || index === 30 || index === 82,
  lead: index === 2,
  glint: index === 59,
})).sort((a, b) => Number(a.near) - Number(b.near) || a.depth - b.depth)
export type Starling = (typeof flock)[number]

export const backgroundStars = Array.from({ length: 12 }, () => ({
  x: 15 + random() * 730,
  y: 12 + random() * 300,
  phase: random() * 2 * Math.PI,
}))

// Time and position along the flock's turn; tangents match across keyframes.
const path = [
  [-2, 174, 174],
  [0, 222, 172],
  [2, 262, 167],
  [4, 372, 149],
  [5.8, 485, 96],
  [6.9, 555, 101],
  [7.8, 551, 143],
  [8.9, 484, 174],
  [10.4, 351, 204],
  [11.7, 246, 177],
  [13, 217, 128],
  [14.3, 285, 100],
  [16, 459, 103],
  [18, 642, 132],
  [20, 826, 135],
] as const

export function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function position(time: number): [number, number] {
  let i = 0
  while (i < path.length - 2 && time > path[i + 1][0]) i++
  const start = path[i]
  const end = path[i + 1]
  const previous = path[Math.max(0, i - 1)]
  const next = path[Math.min(path.length - 1, i + 2)]
  const duration = end[0] - start[0]
  const t = Math.max(0, Math.min(1, (time - start[0]) / duration))
  const t2 = t * t
  const t3 = t2 * t
  function interpolate(axis: 1 | 2) {
    const startTangent = ((end[axis] - previous[axis]) * duration) / (end[0] - previous[0])
    const endTangent = ((next[axis] - start[axis]) * duration) / (next[0] - start[0])
    return (
      (2 * t3 - 3 * t2 + 1) * start[axis] +
      (t3 - 2 * t2 + t) * startTangent +
      (3 * t2 - 2 * t3) * end[axis] +
      (t3 - t2) * endTangent
    )
  }
  return [interpolate(1), interpolate(2)]
}

export function flightPosition(bird: Starling, time: number) {
  const local = time + bird.along * 1.43 + (bird.depth - 0.5) * 0.32
  const [x, y] = position(local)
  const [nextX, nextY] = position(local + 0.045)
  const length = Math.hypot(nextX - x, nextY - y) || 1
  const dx = (nextX - x) / length
  const dy = (nextY - y) / length
  const wave = Math.sin(local * 1.25 + bird.along * 2.2)
  const width = 43 + 15 * Math.sin(time * 0.61) + 17 * wave
  const along = bird.along * 67 + 8 * Math.sin(time * 0.58 + bird.phase)
  const across = bird.across * width + wave * 18 + (bird.depth - 0.5) * 25 + 6 * Math.sin(time * 0.72 + bird.phase)
  // The three foreground birds overtake the flock on the downward pass.
  const near = bird.near ? smooth((time - 5) / 3) * (1 - smooth((time - 11.6) / 2.1)) : 0
  return {
    x: x + dx * along - dy * across + near * (bird.depth - 0.5) * 135,
    y: y + dy * along + dx * across + near * (bird.lead ? 58 : 36),
    near,
  }
}
