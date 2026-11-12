/** Every canvas-drawn surface in the world: station name plates and agent colours. */

import * as THREE from "three"
import type { WorldStation } from "./world-data.ts"

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.CanvasTexture {
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
export function plateTexture(text: string, status: WorldStation["status"], hue: number): THREE.CanvasTexture {
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

export function plateSprite(texture: THREE.CanvasTexture): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(3.9, 0.98, 1)
  sprite.position.y = 3.5
  return sprite
}

export function statusInk(status: WorldStation["status"]): string {
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

/** An engine's colour, from its display name; a shell gets the same treatment as any other. */
export function engineHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return 190 + (Math.abs(hash) % 120)
}
