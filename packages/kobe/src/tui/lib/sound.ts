/**
 * One-shot notification sound. Ported from opencode's
 * `packages/opencode/src/cli/cmd/tui/util/sound.ts` (MIT) and trimmed to
 * a single `pulse()` entry point — kobe only needs a short ding when a
 * background chat tab transitions out of `running`.
 *
 * Probes PATH for the first audio player (cached), writes the bundled
 * `pulse.wav` to `$TMPDIR/kobe-sfx/` (a stable path even from `dist/`),
 * spawns detached with stdio ignored, and swallows failures: the BEL in
 * `notifications.tsx` is the always-on fallback. No player → no-op.
 *
 * VOLUME LIVES IN THE FILE (samples scaled by `wav-volume.ts`, cached per
 * volume), never in argv: `afplay`, `aplay`, `omxplayer` and the
 * `powershell.exe` `Media.SoundPlayer` (Windows' only option) take no volume
 * flag, so an argv volume rang at full level there. Scaling works for every
 * player and can't double-apply.
 */

import { existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, extname, isAbsolute, join, resolve } from "node:path"
import { persistedSoundVolume } from "../../state/sound-volume"
import pulseAssetRaw from "../asset/pulse.wav" with { type: "file" }
import { scaleWavVolume } from "./wav-volume"

// Bun's `type: "file"` import is absolute in dev but chunk-relative in
// `bun build` output; normalise against `import.meta.dir`.
const pulseAsset = isAbsolute(pulseAssetRaw) ? pulseAssetRaw : resolve(import.meta.dir, pulseAssetRaw)

const DIR = join(tmpdir(), "kobe-sfx")

const PLAYERS = [
  "ffplay",
  "mpv",
  "mpg123",
  "mpg321",
  "mplayer",
  "afplay",
  "play",
  "omxplayer",
  "aplay",
  "cmdmp3",
  "cvlc",
  "powershell.exe",
] as const

type Player = (typeof PLAYERS)[number]

/** Play once, no window/video, exit when done. No volume flag: `file` carries the level. */
function args(player: Player, file: string): string[] {
  if (player === "ffplay") return [player, "-autoexit", "-nodisp", file]
  if (player === "mpv") return [player, "--no-video", "--audio-display=no", file]
  if (player === "mplayer") return [player, "-vo", "null", file]
  if (player === "cvlc") return [player, "--play-and-exit", file]
  if (player === "powershell.exe")
    return [player, "-c", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]
  return [player, file]
}

let cachedPlayer: Player | null | undefined
/** One cached asset per volume; the level is baked into the bytes. */
const cachedPaths = new Map<number, Promise<string>>()

/**
 * Split on the platform delimiter: a hard-coded `:` shattered Windows entries
 * on the drive colon, so `powershell.exe` was never found and the chime went
 * silent. Injectable so the win32 split is testable on POSIX.
 */
export function pathDirs(rawPath: string, delim: string = delimiter): string[] {
  return rawPath.split(delim).filter(Boolean)
}

function pickPlayer(): Player | null {
  if (cachedPlayer !== undefined) return cachedPlayer
  const segments = pathDirs(process.env.PATH ?? "")
  cachedPlayer = PLAYERS.find((p) => segments.some((dir) => existsSync(join(dir, p)))) ?? null
  return cachedPlayer
}

/** Cache filename for `volume`: the asset's name with a `@<pct>` tag. */
function assetNameFor(assetPath: string, volume: number): string {
  const name = basename(assetPath)
  const ext = extname(name)
  return `${name.slice(0, name.length - ext.length)}@${Math.round(volume * 100)}${ext}`
}

/**
 * Falls back to unscaled bytes when the asset isn't the 16-bit PCM
 * `scaleWavVolume` understands; wrong level beats no chime.
 */
async function ensureAsset(volume: number): Promise<string> {
  const cached = cachedPaths.get(volume)
  if (cached) return cached
  const pending = (async () => {
    mkdirSync(DIR, { recursive: true })
    const dest = join(DIR, assetNameFor(pulseAsset, volume))
    const out = Bun.file(dest)
    if (await out.exists()) return dest
    const source = Buffer.from(await Bun.file(pulseAsset).arrayBuffer())
    await Bun.write(out, scaleWavVolume(source, volume) ?? source)
    return dest
  })()
  cachedPaths.set(volume, pending)
  return pending
}

/** Best-effort, never throws. Volume 0 spawns nothing. */
export function pulse(volume: number = persistedSoundVolume()): void {
  if (!(volume > 0)) return
  const player = pickPlayer()
  if (!player) return
  void ensureAsset(volume)
    .then((path) => {
      try {
        const proc = Bun.spawn(args(player, path), {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        })
        // Detached so the player doesn't keep Rove alive at shutdown.
        proc.unref?.()
      } catch {
        /* swallow */
      }
    })
    .catch(() => undefined)
}
