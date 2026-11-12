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
import { CELL_X, CELL_Z, coreHeight, stationGrid } from "./iso.ts"
import type { Built, StationKit } from "./scene-station.ts"
import { addStation, dropStation, restyleStation } from "./scene-station.ts"
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

const clock = { last: 0 }

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
  /** The shared parts every station borrows; a fresh tiny object per build call is free. */
  private get kit(): StationKit {
    return {
      scene: this.scene,
      plateGeometry: this.plateGeometry,
      glowGeometry: this.glowGeometry,
      beamGeometry: this.beamGeometry,
      bodyGeometry: this.bodyGeometry,
      bodyMaterial: this.bodyMaterial,
      plateMaterial: this.plateMaterial,
      coreGeometry: this.coreGeometry,
      ringGeometry: this.ringGeometry,
      mastGeometry: this.mastGeometry,
      mastMaterial: this.mastMaterial,
      lampGeometry: this.lampGeometry,
    }
  }

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
    for (const built of this.stations.values()) dropStation(this.kit, built)
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
        if (existing) dropStation(this.kit, existing)
        this.stations.set(station.id, addStation(this.kit, station, slot.x, slot.z, index))
      } else {
        restyleStation(existing, station)
      }
    })
    for (const [id, built] of this.stations) {
      if (seen.has(id)) continue
      dropStation(this.kit, built)
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
