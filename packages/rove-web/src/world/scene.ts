/**
 * The world's frame renderer: one isometric scene, redrawn on requestAnimationFrame, where each
 * task stands as a station, each open session as an agent, and each tool call rides in as a parcel
 * that lands on the station's core. three.js draws the frame; nothing else on the page does — the
 * HUD around the canvas is ordinary DOM.
 *
 * Allocation discipline: geometries and materials are built once and shared, stations are
 * reconciled by id, and parcels come from a fixed pool, so a busy minute does not grow the heap.
 */

import * as THREE from "three"
import type { Beat } from "./beats.ts"
import { CELL_X, CELL_Z, agentSeat, coreHeight, stationGrid } from "./iso.ts"
import { KIND_COLOR, type ToolKind, shortToolName, toolKind } from "./tool-kinds.ts"
import type { WorldStation } from "./world-data.ts"

const BG = 0x0b0d10
const PARCELS = 96
const TOOL_LABELS = 24
const IDLE_FPS = 30
const ACTIVE_FPS = 60

interface Parcel {
  readonly mesh: THREE.Mesh
  curve: THREE.QuadraticBezierCurve3
  live: boolean
  t: number
  speed: number
}

interface ToolLabel {
  readonly sprite: THREE.Sprite
  readonly texture: THREE.CanvasTexture
  readonly canvas: HTMLCanvasElement
  live: boolean
  life: number
}

interface Built {
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

const clock = { last: 0 }

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (ctx) draw(ctx, w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 2
  return texture
}

/** A station's floating name plate: title left, status dot right, drawn once per text change. */
function plateTexture(text: string, status: WorldStation["status"], hue: number): THREE.CanvasTexture {
  const width = 512
  const height = 128
  return canvasTexture(
    (ctx) => {
      ctx.clearRect(0, 0, width, height)
      const ink = `hsl(${hue} 70% 72%)`
      ctx.fillStyle = "rgba(12,14,18,0.82)"
      ctx.beginPath()
      ctx.roundRect(6, 18, width - 12, height - 36, 18)
      ctx.fill()
      ctx.strokeStyle = `hsla(${hue} 60% 60% / 0.5)`
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(38, height / 2, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#eae7df"
      ctx.font = "500 34px ui-monospace, Menlo, monospace"
      ctx.textBaseline = "middle"
      const clipped = text.length > 22 ? `${text.slice(0, 21)}…` : text
      ctx.fillText(clipped, 58, height / 2 + 1)
      ctx.fillStyle = statusInk(status)
      ctx.font = "600 26px ui-monospace, Menlo, monospace"
      ctx.textAlign = "right"
      ctx.fillText(statusText(status), width - 26, height / 2 + 1)
    },
    width,
    height,
  )
}

function plateSprite(texture: THREE.CanvasTexture): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(3.9, 0.98, 1)
  sprite.position.y = 3.5
  return sprite
}

function statusInk(status: WorldStation["status"]): string {
  if (status === "running") return "#9aca86"
  if (status === "needs-input") return "#e8c96b"
  if (status === "attention") return "#ec6f74"
  if (status === "busy") return "#6ee7ff"
  if (status === "unseen") return "#cc785c"
  return "#75706a"
}

function statusText(status: WorldStation["status"]): string {
  return {
    running: "working",
    "needs-input": "waiting",
    attention: "error",
    busy: "starting",
    unseen: "unseen",
    idle: "idle",
  }[status].toUpperCase()
}

function engineHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return 190 + (Math.abs(hash) % 120)
}

export class WorldScene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200)
  private readonly renderer: THREE.WebGLRenderer
  private readonly stations = new Map<string, Built>()
  private readonly hitMeshes: THREE.Mesh[] = []
  private readonly parcels: Parcel[] = []
  private readonly toolLabels: ToolLabel[] = []
  private readonly toolLabelCache = new Map<string, THREE.CanvasTexture>()
  private readonly coreGeometry = new THREE.BoxGeometry(1.5, 0.7, 1.5)
  private readonly plateGeometry = new THREE.CylinderGeometry(1.75, 2.0, 0.34, 6)
  private readonly bodyGeometry = new THREE.BoxGeometry(2.5, 1.15, 2.5)
  private readonly mastGeometry = new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8)
  private readonly lampGeometry = new THREE.SphereGeometry(0.2, 12, 12)
  private readonly parcelGeometry = new THREE.SphereGeometry(0.15, 10, 10)
  private readonly ringGeometry = new THREE.TorusGeometry(2.35, 0.045, 8, 48)
  private readonly glowGeometry = new THREE.CircleGeometry(3.1, 40)
  private readonly beamGeometry = new THREE.CylinderGeometry(1.15, 1.15, 3.2, 20, 1, true)
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.62, metalness: 0.45 })
  private readonly plateMaterial = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.85, metalness: 0.3 })
  private readonly mastMaterial = new THREE.MeshStandardMaterial({ color: 0x2a323d, roughness: 0.5, metalness: 0.6 })
  private readonly kindMaterials = new Map<ToolKind, THREE.MeshStandardMaterial>()
  private readonly frame = { samples: 0, total: 0, fps: 0 }
  private lastCount = -1
  private running = false
  private raf = 0
  private hovered: string | null = null
  private onPick: (taskId: string) => void = () => {}
  private onHover: (taskId: string | null) => void = () => {}
  private readonly observer = new ResizeObserver(() => this.resize())
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.stop()
    else this.start()
  }
  private readonly onPointerMove = (event: PointerEvent) => this.pointerMove(event)
  private readonly onPointerDown = (event: PointerEvent) => this.pointerDown(event)

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    })
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(BG, 1)
    this.scene.fog = new THREE.Fog(BG, 34, 95)
    this.camera.position.set(18, 17, 18)
    this.camera.lookAt(0, 0, 0)
    this.buildStage()
    for (let i = 0; i < PARCELS; i++) this.parcels.push(this.makeParcel())
    for (let i = 0; i < TOOL_LABELS; i++) this.toolLabels.push(this.makeToolLabel())
    this.canvas.addEventListener("pointermove", this.onPointerMove)
    this.canvas.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("visibilitychange", this.onVisibility)
    this.observer.observe(canvas)
    this.resize()
  }

  pick(handler: (taskId: string) => void): void {
    this.onPick = handler
  }

  hover(handler: (taskId: string | null) => void): void {
    this.onHover = handler
  }

  /** Mean frame-to-frame time over the last second, for the HUD. */
  get frameMs(): number {
    return this.frame.samples === 0 ? 0 : this.frame.total / this.frame.samples
  }

  start(): void {
    if (this.running) return
    this.running = true
    clock.last = 0
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      const dt = clock.last === 0 ? 0.016 : Math.min(0.05, (now - clock.last) / 1000)
      const budget = this.busy() ? 1 / ACTIVE_FPS : 1 / IDLE_FPS
      if (now - clock.last < budget * 1000) return
      clock.last = now
      this.step(dt, now / 1000)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  dispose(): void {
    this.stop()
    this.canvas.removeEventListener("pointermove", this.onPointerMove)
    this.canvas.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("visibilitychange", this.onVisibility)
    this.observer.disconnect()
    for (const built of this.stations.values()) this.dropStation(built)
    this.stations.clear()
    this.hitMeshes.length = 0
    for (const material of [...this.kindMaterials.values()]) material.dispose()
    for (const texture of this.toolLabelCache.values()) texture.dispose()
    this.toolLabelCache.clear()
    for (const label of this.toolLabels) label.texture.dispose()
    for (const parcel of this.parcels) parcel.mesh.geometry.dispose()
    this.coreGeometry.dispose()
    this.plateGeometry.dispose()
    this.bodyGeometry.dispose()
    this.mastGeometry.dispose()
    this.lampGeometry.dispose()
    this.parcelGeometry.dispose()
    this.ringGeometry.dispose()
    this.glowGeometry.dispose()
    this.beamGeometry.dispose()
    this.bodyMaterial.dispose()
    this.plateMaterial.dispose()
    this.mastMaterial.dispose()
    this.renderer.dispose()
  }

  /** Reconcile the scene's stations with the daemon's rows: add, remove, and restyle by id. */
  update(stations: readonly WorldStation[]): void {
    const slots = stationGrid(stations.length)
    const seen = new Set<string>()
    stations.forEach((station, index) => {
      seen.add(station.id)
      const slot = slots[index]
      const existing = this.stations.get(station.id)
      if (!existing || existing.labelKey.text !== station.label || existing.pulses !== station.status) {
        if (existing) this.dropStation(existing)
        this.stations.set(station.id, this.addStation(station, slot.x, slot.z, index))
      } else {
        this.restyle(existing, station)
      }
    })
    for (const [id, built] of this.stations) {
      if (seen.has(id)) continue
      this.dropStation(built)
      this.stations.delete(id)
    }
    this.hitMeshes.length = 0
    for (const built of this.stations.values()) this.hitMeshes.push(built.hit)
    this.fit(stations.length)
  }

  /** A call landed: ride a parcel from its agent to the core and name it on arrival. */
  beat(beat: Beat, stationId: string): void {
    const built = this.stations.get(stationId)
    if (!built) return
    const kind = toolKind(beat.name)
    const parcel = this.parcels.find((p) => !p.live) ?? this.parcels[0]
    const seats = built.agents.children
    const seat = seats.length > 0 ? seats[this.lastCount++ % seats.length] : null
    const from = new THREE.Vector3()
    if (seat) seat.getWorldPosition(from)
    else built.group.getWorldPosition(from).add(new THREE.Vector3(0, 0.6, 0))
    const to = new THREE.Vector3(0, coreHeight(), 0)
    built.group.localToWorld(to)
    from.y += 0.75
    const lift = new THREE.Vector3((from.x + to.x) / 2, Math.max(from.y, to.y) + 2.2, (from.z + to.z) / 2)
    parcel.curve = new THREE.QuadraticBezierCurve3(from, lift, to)
    parcel.t = 0
    parcel.speed = 0.9 + Math.random() * 0.25
    parcel.live = true
    parcel.mesh.visible = true
    parcel.mesh.scale.setScalar(1)
    const material = this.kindMaterial(kind)
    parcel.mesh.material = material
    built.core.material.emissiveIntensity = 1.9
    this.showToolLabel(shortToolName(beat.name), kind, to)
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  private buildStage(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    this.scene.add(ground)
    const grid = new THREE.GridHelper(220, 110, 0x3d5474, 0x222d3d)
    grid.position.y = 0
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.9
    this.scene.add(grid)
    this.scene.add(new THREE.HemisphereLight(0x93a3b8, 0x080a0d, 1.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(9, 14, 6)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6688ff, 0.7)
    rim.position.set(-10, 6, -8)
    this.scene.add(rim)
  }

  private addStation(station: WorldStation, x: number, z: number, index: number): Built {
    const hue = station.hue
    const accent = new THREE.Color().setHSL(hue / 360, 0.68, 0.56)
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    group.rotation.y = Math.PI / 4
    group.userData.taskId = station.id

    const plate = new THREE.Mesh(this.plateGeometry, this.plateMaterial)
    plate.position.y = 0.17
    group.add(plate)

    // The station's own light on the floor, and the column of it rising to the plate: what makes a
    // lone station read as a place rather than a box, and lets a busy row glow from a distance.
    const glow = new THREE.Mesh(
      this.glowGeometry,
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
      this.beamGeometry,
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

    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial)
    body.position.y = 0.9
    group.add(body)

    const core = new THREE.Mesh(
      this.coreGeometry,
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
      this.ringGeometry,
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, roughness: 0.4 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.36
    group.add(ring)

    const mast = new THREE.Mesh(this.mastGeometry, this.mastMaterial)
    mast.position.set(1.15, 1.9, 1.15)
    group.add(mast)

    const lamp = new THREE.Mesh(
      this.lampGeometry,
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

    this.scene.add(group)
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
    this.syncAgents(built, station)
    return built
  }

  /** Same station, new status: only the cheap parts (lamp colour, plate text) are redrawn. */
  private restyle(built: Built, station: WorldStation): void {
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
    this.syncAgents(built, station)
  }

  private syncAgents(built: Built, station: WorldStation): void {
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

  private dropStation(built: Built): void {
    this.scene.remove(built.group)
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

  private makeParcel(): Parcel {
    const mesh = new THREE.Mesh(this.parcelGeometry, this.kindMaterial("other"))
    mesh.visible = false
    this.scene.add(mesh)
    return {
      mesh,
      curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(0, 2, 0), new THREE.Vector3()),
      live: false,
      t: 0,
      speed: 1,
    }
  }

  private makeToolLabel(): ToolLabel {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 64
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }),
    )
    sprite.scale.set(2.1, 0.52, 1)
    sprite.visible = false
    this.scene.add(sprite)
    return { sprite, texture, canvas, live: false, life: 0 }
  }

  private showToolLabel(text: string, kind: ToolKind, at: THREE.Vector3): void {
    const label = this.toolLabels.find((l) => !l.live) ?? this.toolLabels[0]
    const ctx = label.canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = "rgba(10,12,16,0.85)"
    ctx.beginPath()
    ctx.roundRect(4, 10, 248, 44, 10)
    ctx.fill()
    ctx.strokeStyle = `#${KIND_COLOR[kind].toString(16).padStart(6, "0")}`
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = ctx.strokeStyle
    ctx.font = "600 26px ui-monospace, Menlo, monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, 128, 33)
    label.texture.needsUpdate = true
    label.sprite.position.copy(at).add(new THREE.Vector3(0, 0.9, 0))
    label.sprite.visible = true
    label.live = true
    label.life = 1.4
  }

  private kindMaterial(kind: ToolKind): THREE.MeshStandardMaterial {
    const known = this.kindMaterials.get(kind)
    if (known) return known
    const color = new THREE.Color(KIND_COLOR[kind])
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.1,
    })
    this.kindMaterials.set(kind, material)
    return material
  }

  // ── frame ────────────────────────────────────────────────────────────────────────────────────

  private busy(): boolean {
    for (const built of this.stations.values()) if (built.pulses === "running" || built.pulses === "busy") return true
    return this.parcels.some((parcel) => parcel.live)
  }

  private step(dt: number, time: number): void {
    const started = performance.now()
    for (const built of this.stations.values()) {
      const state = built.pulses
      const speed = state === "busy" ? 2.6 : state === "running" ? 1.1 : 0.25
      built.ring.rotation.z += dt * speed
      const pulse = state === "running" ? 0.85 + Math.sin(time * 3.2 + built.angle) * 0.45 : 0.55
      built.core.material.emissiveIntensity += (Math.max(0.45, pulse) - built.core.material.emissiveIntensity) * 0.12
      built.core.rotation.y += dt * (state === "running" ? 0.8 : 0.15)
      const lampPulse = state === "running" ? 1 + Math.sin(time * 5 + built.angle) * 0.4 : 0.7
      built.lamp.material.emissiveIntensity = lampPulse
      for (const child of built.agents.children) {
        const agent = child as THREE.Mesh
        const phase = (agent.userData.phase as number) ?? 0
        agent.position.y = 0.5 + Math.sin(time * 1.8 + phase) * 0.06 + (agent.userData.working ? 0.12 : 0)
        agent.rotation.y = Math.sin(time * 0.6 + phase) * 0.4
      }
    }
    for (const parcel of this.parcels) {
      if (!parcel.live) continue
      parcel.t = Math.min(1, parcel.t + dt * parcel.speed)
      const at = parcel.curve.getPoint(parcel.t)
      parcel.mesh.position.copy(at)
      parcel.mesh.scale.setScalar(1 + Math.sin(time * 12) * 0.12)
      if (parcel.t >= 1) {
        parcel.live = false
        parcel.mesh.visible = false
      }
    }
    for (const label of this.toolLabels) {
      if (!label.live) continue
      label.life -= dt
      label.sprite.position.y += dt * 0.55
      const fade = Math.max(0, Math.min(1, label.life / 0.5))
      ;(label.sprite.material as THREE.SpriteMaterial).opacity = fade
      if (label.life <= 0) {
        label.live = false
        label.sprite.visible = false
      }
    }
    this.renderer.render(this.scene, this.camera)
    this.frame.samples++
    this.frame.total += performance.now() - started
    if (this.frame.samples >= 60) {
      this.frame.fps = 1000 / Math.max(0.001, this.frame.total / this.frame.samples)
      this.frame.samples = 0
      this.frame.total = 0
    }
  }

  private fit(count: number): void {
    const columns = Math.min(4, Math.max(1, count))
    const rows = Math.max(1, Math.ceil(count / 4))
    const width = (columns - 1) * CELL_X
    const depth = rows * CELL_Z
    // An isometric view spreads both axes across the screen: fit the union, not the station count.
    const needHeight = Math.max(11, depth + 10)
    const needWidth = Math.max(15, width + depth + 10)
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)
    const height = Math.max(needHeight, needWidth / Math.max(0.4, aspect))
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.left = (-height / 2) * aspect
    this.camera.right = (height / 2) * aspect
    this.camera.updateProjectionMatrix()
  }

  private resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.fit(this.stations.size)
  }

  private pickAt(event: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.intersectObjects(this.hitMeshes, false)[0]
    return (hit?.object.userData.taskId as string | undefined) ?? null
  }

  private pointerMove(event: PointerEvent): void {
    const id = this.pickAt(event)
    if (id === this.hovered) return
    this.hovered = id
    this.canvas.style.cursor = id ? "pointer" : "default"
    this.onHover(id)
  }

  private pointerDown(event: PointerEvent): void {
    const id = this.pickAt(event)
    if (id) this.onPick(id)
  }
}
