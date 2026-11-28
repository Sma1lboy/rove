/**
 * Filesystem loader for user appearance packs under `<roveStateDir()>/appearances/<name>/`.
 * Node/Bun only — browser bundles must import from `./index.ts` instead.
 *
 * Never throws on broken packs: every failure (invalid name, unreadable file,
 * bad JSON, manifest validation issues, missing or escaping component file) is
 * returned as a structured `AppearancePackFailure` so clients can fall back to
 * the default appearance and surface exact diagnostics.
 */

import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, join, resolve, sep } from "node:path"
import { roveStateDir } from "@sma1lboy/rove-core/env.ts"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { ROVE_STATE_DIR_BASENAME } from "@sma1lboy/rove-core/product.ts"
import {
  type AppearanceManifest,
  type AppearanceValidationIssue,
  validateAppearanceManifest,
  validateAppearancePackId,
} from "./manifest.ts"
import type { AppearanceSlotId } from "./slots.ts"

export const APPEARANCE_MANIFEST_FILE = "appearance.json"

/** `<home>/.rove/appearances`. Not created here — missing dir means no user packs. */
export function userAppearancesDir(homeDir?: string): string {
  return join(homeDir ? join(homeDir, ROVE_STATE_DIR_BASENAME) : roveStateDir(), "appearances")
}

export interface LoadedSlotComponent {
  readonly slot: AppearanceSlotId
  readonly relPath: string
  readonly absPath: string
  readonly exportName: string
}

export interface LoadedAppearancePack {
  readonly id: string
  readonly dir: string
  readonly manifestPath: string
  readonly manifest: AppearanceManifest
  /** Changes whenever `appearance.json` or any file under `components/` changes on disk. */
  readonly fingerprint: string
  readonly components: readonly LoadedSlotComponent[]
}

export interface AppearancePackFailure {
  readonly id: string
  readonly dir: string
  readonly file: string
  readonly slot?: AppearanceSlotId
  readonly kind: "name" | "io" | "json" | "manifest" | "component"
  readonly message: string
  readonly issues?: readonly AppearanceValidationIssue[]
}

export type LoadAppearancePackResult =
  | { readonly ok: true; readonly pack: LoadedAppearancePack }
  | { readonly ok: false; readonly error: AppearancePackFailure }

export interface LoadedAppearancesResult {
  readonly dir: string
  readonly packs: readonly LoadedAppearancePack[]
  readonly errors: readonly AppearancePackFailure[]
}

function collectComponentFiles(dir: string, acc: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  entries.sort()
  for (const name of entries) {
    const full = join(dir, name)
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) collectComponentFiles(full, acc)
    else if (st.isFile()) acc.push(full)
  }
}

function computeFingerprint(packDir: string, manifestPath: string): string {
  const hash = createHash("sha1")
  const files = [manifestPath]
  const compDir = join(packDir, "components")
  if (existsSync(compDir)) collectComponentFiles(compDir, files)
  for (const file of files) {
    try {
      const st = statSync(file)
      hash.update(`${file}:${st.size}:${st.mtimeMs}\n`)
    } catch {
      hash.update(`${file}:missing\n`)
    }
  }
  return hash.digest("hex").slice(0, 12)
}

/** Load and validate a single appearance pack directory. Never throws. */
export function loadAppearancePack(packDir: string, explicitId?: string): LoadAppearancePackResult {
  const absDir = resolve(packDir)
  const id = explicitId ?? basename(absDir)
  const manifestPath = join(absDir, APPEARANCE_MANIFEST_FILE)

  const badName = validateAppearancePackId(id)
  if (badName) {
    return {
      ok: false,
      error: { id, dir: absDir, file: absDir, kind: "name", message: badName },
    }
  }

  let rawText: string
  try {
    rawText = readFileSync(manifestPath, "utf8")
  } catch (err) {
    return {
      ok: false,
      error: {
        id,
        dir: absDir,
        file: APPEARANCE_MANIFEST_FILE,
        kind: "io",
        message: `could not read ${APPEARANCE_MANIFEST_FILE}: ${errorMessage(err)}`,
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    return {
      ok: false,
      error: {
        id,
        dir: absDir,
        file: APPEARANCE_MANIFEST_FILE,
        kind: "json",
        message: `invalid JSON in ${APPEARANCE_MANIFEST_FILE}: ${errorMessage(err)}`,
      },
    }
  }

  const validated = validateAppearanceManifest(parsed)
  if (!validated.ok) {
    return {
      ok: false,
      error: {
        id,
        dir: absDir,
        file: APPEARANCE_MANIFEST_FILE,
        kind: "manifest",
        message: validated.summary,
        issues: validated.issues,
      },
    }
  }

  let realPackDir: string
  try {
    realPackDir = realpathSync(absDir)
  } catch (err) {
    return {
      ok: false,
      error: {
        id,
        dir: absDir,
        file: absDir,
        kind: "io",
        message: `could not resolve pack directory: ${errorMessage(err)}`,
      },
    }
  }

  const components: LoadedSlotComponent[] = []
  const slots = validated.manifest.slots ?? {}
  for (const [slotKey, spec] of Object.entries(slots)) {
    if (!spec?.component) continue
    const slot = slotKey as AppearanceSlotId
    const candidate = resolve(absDir, spec.component)
    if (!candidate.startsWith(absDir + sep)) {
      return {
        ok: false,
        error: {
          id,
          dir: absDir,
          file: spec.component,
          slot,
          kind: "component",
          message: `slot "${slot}" component "${spec.component}" escapes the pack directory`,
        },
      }
    }
    if (!existsSync(candidate)) {
      return {
        ok: false,
        error: {
          id,
          dir: absDir,
          file: spec.component,
          slot,
          kind: "component",
          message: `slot "${slot}" component "${spec.component}" does not exist`,
        },
      }
    }
    let realTarget: string
    try {
      realTarget = realpathSync(candidate)
    } catch (err) {
      return {
        ok: false,
        error: {
          id,
          dir: absDir,
          file: spec.component,
          slot,
          kind: "component",
          message: `could not resolve slot "${slot}" component "${spec.component}": ${errorMessage(err)}`,
        },
      }
    }
    if (!realTarget.startsWith(realPackDir + sep)) {
      return {
        ok: false,
        error: {
          id,
          dir: absDir,
          file: spec.component,
          slot,
          kind: "component",
          message: `slot "${slot}" component "${spec.component}" symlink points outside the pack directory`,
        },
      }
    }
    try {
      if (!statSync(realTarget).isFile()) {
        return {
          ok: false,
          error: {
            id,
            dir: absDir,
            file: spec.component,
            slot,
            kind: "component",
            message: `slot "${slot}" component "${spec.component}" is not a regular file`,
          },
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          id,
          dir: absDir,
          file: spec.component,
          slot,
          kind: "component",
          message: `could not stat slot "${slot}" component "${spec.component}": ${errorMessage(err)}`,
        },
      }
    }
    components.push({
      slot,
      relPath: spec.component,
      absPath: realTarget,
      exportName: spec.export ?? "default",
    })
  }

  return {
    ok: true,
    pack: {
      id,
      dir: absDir,
      manifestPath,
      manifest: validated.manifest,
      fingerprint: computeFingerprint(absDir, manifestPath),
      components,
    },
  }
}

/**
 * Scan `<home>/.rove/appearances/` for pack directories. Missing directory is
 * normal on fresh installs and returns empty `packs` and `errors`.
 */
export function loadUserAppearances(dir?: string): LoadedAppearancesResult {
  const root = dir ?? userAppearancesDir()
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return { dir: root, packs: [], errors: [] }
  }
  entries.sort()
  const packs: LoadedAppearancePack[] = []
  const errors: AppearancePackFailure[] = []
  for (const name of entries) {
    if (name.startsWith(".")) continue
    const full = join(root, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    const loaded = loadAppearancePack(full, name)
    if (loaded.ok) packs.push(loaded.pack)
    else errors.push(loaded.error)
  }
  return { dir: root, packs, errors }
}
