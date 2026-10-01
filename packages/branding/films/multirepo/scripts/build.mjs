// Writes index.html from src/ + scenes.json + clips/clips.json.
//
// A HyperFrames root `data-duration` is read once at compile time, so scene
// timing cannot be computed in the page. Every start and duration below is
// derived here from the clip durations the cast renderer reports; a re-take
// changes clips.json and nothing else.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = (path) => readFileSync(resolve(dir, path), "utf8")
const readJson = (path) => JSON.parse(read(path))

const FPS = 30
const KEYS = ["r", "o", "v", "e", "⏎"]

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** HTML attribute seconds that never land after the true frame boundary. */
const seconds = (frames) => Math.floor((frames / FPS) * 1e6) / 1e6

function loadClips(scenes) {
  const cut = readJson("cut.json").clips
  const manifestPath = resolve(dir, "clips/clips.json")
  if (!existsSync(manifestPath)) throw new Error("clips/clips.json is missing: render the clips first")
  const manifest = readJson("clips/clips.json")
  const used = new Set(scenes.flatMap((scene) => scene.clips ?? []))
  for (const id of used) {
    if (!cut[id]) throw new Error(`scenes.json uses clip "${id}" that cut.json does not define`)
    if (!manifest[id]) throw new Error(`clips.json has no entry for clip "${id}"`)
    const { width, height } = manifest[id]
    if (Math.abs(width / height - 16 / 9) > 0.01) throw new Error(`clip "${id}" is ${width}x${height}, not 16:9`)
    if (!existsSync(resolve(dir, `clips/${id}.mp4`))) throw new Error(`clips/${id}.mp4 is missing`)
  }
  for (const id of Object.keys(cut)) if (!used.has(id)) throw new Error(`cut.json clip "${id}" is not used by any scene`)
  return manifest
}

/** Lay scenes end to end on the frame grid; a take scene is as long as its clips. */
function layout(scenes, manifest) {
  let cursor = 0
  return scenes.map((scene, index) => {
    const clips = (scene.clips ?? []).map((id) => {
      const frames = Math.round(manifest[id].duration * FPS)
      const clip = { id, start: cursor, frames }
      cursor += frames
      return clip
    })
    const start = clips.length ? clips[0].start : cursor
    if (!clips.length) cursor += Math.round(scene.seconds * FPS)
    return { ...scene, index, clips, start, frames: cursor - start }
  })
}

function film(scenes) {
  return scenes.map((scene) => {
    const clipNamed = (id) => scene.clips.find((clip) => clip.id === id)
    const keyClip = scene.keyPress && clipNamed(scene.keyPress.clip)
    return {
      index: scene.index,
      kind: scene.kind,
      start: scene.start / FPS,
      dur: scene.frames / FPS,
      end: (scene.start + scene.frames) / FPS,
      hasCaption: Boolean(scene.caption),
      openIn: Boolean(scene.openIn),
      closeOut: Boolean(scene.closeOut),
      zoomSidebar: Boolean(scene.zoomSidebar),
      keyCount: scene.kind === "keys" ? KEYS.length : 0,
      keyPress: keyClip ? (keyClip.start + keyClip.frames) / FPS - scene.keyPress.fromEnd : null,
      kickers: (scene.kickerChanges ?? []).map((change, i) => ({ slot: i + 1, at: clipNamed(change.clip).start / FPS + change.at })),
    }
  })
}

/** U+23CE is in none of the shipped fonts, so the ⏎ keycap draws its outline itself. */
const RETURN_ICON =
  '<svg class="ret" viewBox="0 0 29.5 31" width="29.5" height="31"><path d="M19.25 .5H28V25.25H10.5V29.85L.5 20.25L10.5 10.5V14.85H19.25Z"/></svg>'

const keyRow = () =>
  KEYS.map((key, i) =>
    key === "⏎" ? `<div class="key key-${i} wide">${RETURN_ICON}</div>` : `<div class="key key-${i}">${key}</div>`,
  ).join("")

/** `[n]` in a caption renders as a keycap, so the key reads as a key. */
const headline = (text) =>
  text
    .split(/(\[[^\]]+\])/)
    .map((part) => (part.startsWith("[") ? `<span class="cap-key">${escape(part.slice(1, -1))}</span>` : escape(part)))
    .join("")

function captionLayer(scene) {
  const kickers = [scene.kicker ?? "", ...(scene.kickerChanges ?? []).map((change) => change.text)]
  const spans = kickers.map((text, i) => `<span class="k${i}">${escape(text)}</span>`).join("")
  const track = 3 + (scene.index % 2)
  return layer(`cap-${scene.index}`, scene, track, `<div class="caption"><div class="kicker">${spans}</div><div class="headline">${headline(scene.caption)}</div></div>`)
}

function layer(id, scene, track, inner) {
  return `      <section id="${id}" class="clip layer" data-start="${seconds(scene.start)}" data-duration="${seconds(scene.frames)}" data-track-index="${track}">${inner}</section>`
}

const END_CARD = `<div class="end"><div class="end-title"><div class="end-mark">[rove]</div><div class="end-tag">Parallel coding agents in your terminal.</div></div><div class="end-cmd"><b>$</b> curl -fsSL https://rove.run/install.sh | sh</div><div class="end-site">rove.run</div></div>`

export function build() {
  const storyboard = readJson("scenes.json").scenes
  const scenes = layout(storyboard, loadClips(storyboard))
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0)

  const videos = scenes
    .flatMap((scene) => scene.clips)
    .map(
      (clip) =>
        // Sized inline, in window pixels: the renderer swaps each video for its
        // extracted frames and keeps only inline styles, so a stylesheet 100%
        // leaves a 2x capture at its intrinsic size.
        `              <video id="clip-${clip.id}" src="clips/${clip.id}.mp4" data-start="${seconds(clip.start)}" data-duration="${seconds(clip.frames)}" data-track-index="0" muted playsinline style="position:absolute;left:0;top:0;width:1483.2px;height:834.3px;object-fit:fill"></video>`,
    )
  const keyRings = scenes
    .filter((scene) => scene.keyPress)
    .map((scene) => `              <div id="ring-key-${scene.index}" class="ring-key"></div>`)
  const layers = scenes.flatMap((scene) => [
    ...(scene.kind === "keys" ? [layer(`keys-${scene.index}`, scene, 1, `<div class="keys"><div class="keys-row">${keyRow()}</div></div>`)] : []),
    ...(scene.kind === "end" ? [layer("end", scene, 1, END_CARD)] : []),
    ...(scene.caption ? [captionLayer(scene)] : []),
  ])

  const html = read("src/index.template.html")
    .replace("{{CSS}}", () => read("src/film.css"))
    .replace("{{DURATION}}", () => String(Math.round((totalFrames / FPS) * 1e6) / 1e6))
    .replace("{{VIDEOS}}", () => videos.join("\n"))
    .replace("{{KEY_RINGS}}", () => keyRings.join("\n"))
    .replace("{{LAYERS}}", () => layers.join("\n"))
    .replace("{{FILM}}", () => JSON.stringify({ fps: FPS, total: totalFrames / FPS, scenes: film(scenes) }))
    .replace("{{JS}}", () => read("src/film.js"))
  writeFileSync(resolve(dir, "index.html"), html)
  return { frames: totalFrames, seconds: totalFrames / FPS, scenes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { frames, seconds: total } = build()
  console.log(`index.html: ${frames} frames, ${total.toFixed(3)}s`)
}
