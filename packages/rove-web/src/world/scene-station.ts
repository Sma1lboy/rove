/**
 * One station's geometry and lifecycle: building it from a task row, restyling it when its status
 * or title changes, and freeing everything it allocated. The scene passes in its shared geometries
 * and materials so a station owns only the materials that carry its own hue and status.
 */

import * as THREE from "three"
import { agentSeat, coreHeight } from "./iso.ts"
import { engineHue, plateSprite, plateTexture, statusInk } from "./scene-paint.ts"
import type { WorldStation } from "./world-data.ts"

export interface Built {
  readonly group: THREE.Group
  readonly core: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  readonly lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  readonly hit: THREE.Mesh
  readonly agents: THREE.Group
  readonly label: THREE.Sprite
  readonly labelKey: { text: string }
  readonly extra: readonly THREE.Mesh[]
  pulses: WorldStation["status"]
  readonly angle: number
}

/** What a station borrows from the scene: added to its scene, drawn with its shared geometry. */
export interface StationKit {
  readonly scene: THREE.Scene
  readonly plateGeometry: THREE.CylinderGeometry
  readonly glowGeometry: THREE.CircleGeometry
  readonly beamGeometry: THREE.CylinderGeometry
  readonly bodyGeometry: THREE.BoxGeometry
  readonly bodyMaterial: THREE.MeshStandardMaterial
  readonly plateMaterial: THREE.MeshStandardMaterial
  readonly coreGeometry: THREE.BoxGeometry
  readonly ringGeometry: THREE.TorusGeometry
  readonly mastGeometry: THREE.CylinderGeometry
  readonly mastMaterial: THREE.MeshStandardMaterial
  readonly lampGeometry: THREE.SphereGeometry
}

export function addStation(kit: StationKit, station: WorldStation, x: number, z: number, index: number): Built {
  const hue = station.hue
  const accent = new THREE.Color().setHSL(hue / 360, 0.68, 0.56)
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.rotation.y = Math.PI / 4
  group.userData.taskId = station.id

  const plate = new THREE.Mesh(kit.plateGeometry, kit.plateMaterial)
  plate.position.y = 0.17
  group.add(plate)

  // The station's own light on the floor, and the column of it rising to the plate: what makes a
  // lone station read as a place rather than a box, and lets a busy row glow from a distance.
  const glow = new THREE.Mesh(
    kit.glowGeometry,
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.y = 0.012
  group.add(glow)
  const beam = new THREE.Mesh(
    kit.beamGeometry,
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  beam.position.y = 1.7
  group.add(beam)

  const body = new THREE.Mesh(kit.bodyGeometry, kit.bodyMaterial)
  body.position.y = 0.9
  group.add(body)

  const core = new THREE.Mesh(
    kit.coreGeometry,
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      metalness: 0.2,
    }),
  )
  core.position.y = coreHeight()
  group.add(core)

  const ring = new THREE.Mesh(
    kit.ringGeometry,
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, roughness: 0.4 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.36
  group.add(ring)

  const mast = new THREE.Mesh(kit.mastGeometry, kit.mastMaterial)
  mast.position.set(1.15, 1.9, 1.15)
  group.add(mast)

  const lamp = new THREE.Mesh(
    kit.lampGeometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(statusInk(station.status)),
      emissive: new THREE.Color(statusInk(station.status)),
      emissiveIntensity: 1,
    }),
  )
  lamp.position.set(1.15, 2.65, 1.15)
  group.add(lamp)

  const agents = new THREE.Group()
  agents.position.y = 0
  group.add(agents)

  const label = plateSprite(plateTexture(station.label, station.status, hue))
  // Every other row's plate hangs higher, so two rows never stack their titles on one line.
  label.position.y += (index % 2) * 1.6
  group.add(label)

  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 3.6), new THREE.MeshBasicMaterial({ visible: false }))
  hit.position.y = 1.4
  hit.userData.taskId = station.id
  group.add(hit)

  kit.scene.add(group)
  const built: Built = {
    group,
    core,
    ring,
    lamp,
    hit,
    agents,
    label,
    labelKey: { text: station.label },
    extra: [glow, beam],
    pulses: station.status,
    angle: index * 0.7,
  }
  syncAgents(built, station)
  return built
}

/** Same station, new status: only the cheap parts (lamp colour, plate text) are redrawn. */
export function restyleStation(built: Built, station: WorldStation): void {
  if (built.labelKey.text !== station.label || built.pulses !== station.status) {
    built.label.material.map?.dispose()
    built.label.material.map = plateTexture(station.label, station.status, station.hue)
    built.label.material.needsUpdate = true
    built.labelKey.text = station.label
    built.pulses = station.status
    const ink = new THREE.Color(statusInk(station.status))
    built.lamp.material.color.copy(ink)
    built.lamp.material.emissive.copy(ink)
  }
  syncAgents(built, station)
}

function syncAgents(built: Built, station: WorldStation): void {
  const want = station.agents.filter((agent) => agent.alive).slice(0, 6)
  while (built.agents.children.length > want.length) {
    const gone = built.agents.children[built.agents.children.length - 1] as THREE.Mesh | undefined
    if (!gone) break
    built.agents.remove(gone)
    gone.geometry.dispose()
    ;(gone.material as THREE.Material).dispose()
    for (const part of gone.children) {
      const mesh = part as THREE.Mesh
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  }
  want.forEach((agent, index) => {
    let mesh = built.agents.children[index] as THREE.Mesh | undefined
    if (!mesh) {
      const tone = new THREE.Color().setHSL(engineHue(agent.engine) / 360, 0.4, 0.66)
      const body = new THREE.CapsuleGeometry(0.22, 0.52, 4, 10)
      mesh = new THREE.Mesh(
        body,
        new THREE.MeshStandardMaterial({ color: tone, emissive: tone, emissiveIntensity: 0.25, roughness: 0.6 }),
      )
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 }),
      )
      head.position.y = 0.56
      mesh.add(head)
      built.agents.add(mesh)
    }
    const seat = agentSeat(index, want.length)
    const drop = index % 2 === 0 ? 1 : 0.35
    mesh.position.set(seat.x, 0.42 + drop, seat.z)
    mesh.userData.phase = index * 1.7
    mesh.userData.working = built.pulses === "running"
  })
}

export function dropStation(kit: StationKit, built: Built): void {
  kit.scene.remove(built.group)
  built.label.material.map?.dispose()
  built.label.material.dispose()
  built.core.material.dispose()
  built.ring.material.dispose()
  built.lamp.material.dispose()
  for (const mesh of built.extra) (mesh.material as THREE.Material).dispose()
  built.hit.geometry.dispose()
  ;(built.hit.material as THREE.Material).dispose()
  for (const child of [...built.agents.children]) {
    const mesh = child as THREE.Mesh
    mesh.geometry.dispose()
    for (const grand of mesh.children) {
      const part = grand as THREE.Mesh
      part.geometry.dispose()
      ;(part.material as THREE.Material).dispose()
    }
    ;(mesh.material as THREE.Material).dispose()
  }
  built.agents.clear()
}
