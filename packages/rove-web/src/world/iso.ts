/**
 * Where things stand in the world: a serpentine grid of stations on the ground plane, and the
 * seats its agents take around one. Plain numbers, no three.js, so the layout is testable and
 * the scene only has to place what this returns.
 */

export interface Slot {
  readonly x: number
  readonly z: number
}

/** Ground units between two stations, and how many fit across before the row folds back. */
export const CELL_X = 7
export const CELL_Z = 6.4

/** Stations in reading order, each row running the other way, centred on the origin. */
export function stationGrid(count: number, perRow = 4): Slot[] {
  const slots: Slot[] = []
  if (count <= 0) return slots
  const columns = Math.max(1, Math.min(perRow, count))
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns)
    const col = i % columns
    const x = (row % 2 === 0 ? col : columns - 1 - col) - (columns - 1) / 2
    slots.push({ x: x * CELL_X, z: row * CELL_Z })
  }
  const zMid = ((Math.ceil(count / columns) - 1) * CELL_Z) / 2
  return slots.map((slot) => ({ x: slot.x, z: slot.z - zMid }))
}

/** Seats around a station's front half: agents stand where the camera can see them. */
export function agentSeat(index: number, count: number): Slot {
  const spread = Math.min(Math.PI * 1.1, 0.5 + count * 0.28)
  const angle = count <= 1 ? Math.PI / 2 : Math.PI / 2 + spread / 2 - (index / (count - 1)) * spread
  const radius = 2.1 + (index % 2) * 0.32
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius + 0.5 }
}

/** The ring a call's parcel rides to, above the station's core. */
export function coreHeight(): number {
  return 1.55
}
