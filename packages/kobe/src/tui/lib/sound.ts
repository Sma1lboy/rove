/**
 * One-shot notification sound. Ported from opencode's
 * `packages/opencode/src/cli/cmd/tui/util/sound.ts` (MIT) and trimmed to
 * a single `pulse()` entry point — kobe only needs a short ding when a
 * background chat tab transitions out of `running`.
 *
 * Strategy:
 *   1. Probe the user's PATH for the first available audio player
 *      (afplay on macOS, ffplay/mpv/play/aplay/etc. elsewhere) and cache
 *      the choice.
 *   2. Write the bundled `pulse.wav` to `$TMPDIR/kobe-sfx/` on first use,
 *      its samples already scaled to the user's volume
 *      (`state/sound-volume.ts`) and cached per volume. The asset then has
 *      a stable filesystem path even when kobe runs from the bundled
 *      `dist/`, and repeated spawns stay cheap.
 *   3. Spawn the player detached with all stdio ignored. Failures are
 *      swallowed — the BEL in `notifications.tsx` is the always-on
 *      fallback; this just adds an audible chime on top.
 *
 * VOLUME LIVES IN THE FILE, never in the player's argv. Four of the players
 * below take no volume flag at all — `afplay`, `aplay`, `omxplayer`, and the
 * `powershell.exe` fallback, whose `Media.SoundPlayer` class has no volume
 * API (Play, PlaySync, PlayLooping, Stop, and nothing else). Windows only
 * ever reaches that last one, so a volume passed as an argument was silently
 * discarded there: the chime rang at full system level and no setting could
 * lower it. Scaling the samples (`wav-volume.ts`) is one mechanism every
 * player honours, and it cannot double-apply.
 *
 * If no player is on PATH (rare on a Mac dev box, common in stripped CI
 * containers), `pulse()` is a no-op and we rely on the terminal bell.
 */

import { existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, extname, isAbsolute, join, resolve } from "node:path"
import { persistedSoundVolume } from "../../state/sound-volume"
import pulseAssetRaw from "../asset/pulse.wav" with { type: "file" }
import { scaleWavVolume } from "./wav-volume"

// Bun's `with { type: "file" }` import returns an absolute path in dev
// and a path relative to the emitting chunk in `bun build` output.
// Normalise against `import.meta.dir` so both modes resolve to a real
// file on disk.
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

/**
 * Per-player argv to play `file` once and get out of the way (no window, no
 * video, exit when done). No volume flag anywhere: `file` already carries
 * the level — see the file header.
 */
export function args(player: Player, file: string): string[] {
  if (player === "ffplay") return [player, "-autoexit", "-nodisp", file]
  if (player === "mpv") return [player, "--no-video", "--audio-display=no", file]
  if (player === "mplayer") return [player, "-vo", "null", file]
  if (player === "cvlc") return [player, "--play-and-exit", file]
  if (player === "powershell.exe")
    return [player, "-c", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]
  return [player, file]
}

let cachedPlayer: Player | null | undefined
/** One cached asset per volume — the level is baked into the bytes. */
const cachedPaths = new Map<number, Promise<string>>()

/**
 * Directories on a PATH string, split on the platform's list delimiter
 * (`;` on Windows, `:` elsewhere) and stripped of empty entries. Splitting
 * on a hard-coded `:` shattered every Windows entry on its drive-letter
 * colon (`C:\Windows\System32` → `["C", "\\Windows\\System32"]`), so no real
 * directory ever matched and `powershell.exe` was never found — the chime
 * went permanently silent on Windows with only the terminal BEL left. The
 * delimiter is injectable so that win32 split is unit-testable on a POSIX host.
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
export function assetNameFor(assetPath: string, volume: number): string {
  const name = basename(assetPath)
  const ext = extname(name)
  return `${name.slice(0, name.length - ext.length)}@${Math.round(volume * 100)}${ext}`
}

/**
 * Path to the chime at `volume`, written into the tmp cache on first use.
 * Falls back to the unscaled bytes when the asset is not the 16-bit PCM
 * `scaleWavVolume` understands — a chime at the wrong level still beats no
 * chime, and the bundled asset is the only input in practice.
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

/**
 * Fire one short ding at the user's configured volume. Best-effort, never
 * throws. Volume 0 is silence, and nothing is spawned for it — a muted chime
 * costs no process.
 */
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
        // Detach so the player's lifetime doesn't keep kobe alive at
        // shutdown. Bun's `unref()` is on the underlying Subprocess.
        proc.unref?.()
      } catch {
        /* swallow */
      }
    })
    .catch(() => undefined)
}
