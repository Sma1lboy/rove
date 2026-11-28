/**
 * Strict validator for `appearance.json` manifests. Reuses Rove's theme color
 * grammar (`rove-core/theme`) and the Mods declarative element tree validator
 * (`rove-daemon/plugins/mod-tree`).
 *
 * Unknown keys and invalid types reject the whole manifest with exact paths and
 * reasons so clients can fall back to the default UI and surface every error.
 */

import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"
import { type ModNode, validateModTree } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import { rejectUnknownKeys, typeLabel, validateAppearanceColors } from "./manifest-colors.ts"
import {
  APPEARANCE_BORDER_STYLES,
  APPEARANCE_DENSITIES,
  APPEARANCE_FRAMES,
  APPEARANCE_NAME_RE,
  APPEARANCE_SCHEMA_VERSION,
  APPEARANCE_SLOT_SURFACES,
  APPEARANCE_SLOT_VARIANTS,
  APPEARANCE_STATUS_BAR_MODES,
  type AppearanceLayout,
  type AppearanceSlotSpec,
  type AppearanceValidateResult,
  type AppearanceValidationIssue,
} from "./manifest-types.ts"
import { APPEARANCE_SLOTS, type AppearanceSlotId, DEFAULT_APPEARANCE_PACK, SLOT_FIELDS } from "./slots.ts"

export * from "./manifest-types.ts"

const COMPONENT_PATH_RE = /^components\/[A-Za-z0-9._/-]+\.(?:tsx|ts|jsx|js)$/
const EXPORT_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/

const TOP_KEYS = new Set(["$schema", "version", "name", "description", "author", "theme", "colors", "layout", "slots"])
const LAYOUT_KEYS = new Set([
  "frame",
  "paneGap",
  "shellPadding",
  "radius",
  "radiusSm",
  "radiusXs",
  "density",
  "railWidth",
  "borderStyle",
  "statusBar",
])
const SLOT_SET = new Set<string>(APPEARANCE_SLOTS)
const SLOT_SPEC_KEYS = new Set([
  "component",
  "export",
  "fields",
  "secondaryFields",
  "tree",
  "hidden",
  "surface",
  "variant",
])

function checkIntRange(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  issues: AppearanceValidationIssue[],
): number | undefined {
  const raw = obj[key]
  if (raw === undefined) return undefined
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    issues.push({
      path: `layout.${key}`,
      message: `must be an integer between ${min} and ${max} (got ${JSON.stringify(raw)})`,
    })
    return undefined
  }
  return raw
}

function checkEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
  issues: AppearanceValidationIssue[],
): T | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    issues.push({ path, message: `must be one of ${allowed.join(", ")} (got ${JSON.stringify(raw)})` })
    return undefined
  }
  return raw as T
}

function validateLayout(raw: unknown, issues: AppearanceValidationIssue[]): AppearanceLayout | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    issues.push({ path: "layout", message: `must be an object (got ${typeLabel(raw)})` })
    return undefined
  }
  rejectUnknownKeys(raw, LAYOUT_KEYS, "layout", issues)
  const frame = checkEnum(raw.frame, APPEARANCE_FRAMES, "layout.frame", issues)
  const paneGap = checkIntRange(raw, "paneGap", 0, 32, issues)
  const shellPadding = checkIntRange(raw, "shellPadding", 0, 32, issues)
  const radius = checkIntRange(raw, "radius", 0, 24, issues)
  const radiusSm = checkIntRange(raw, "radiusSm", 0, 20, issues)
  const radiusXs = checkIntRange(raw, "radiusXs", 0, 16, issues)
  const density = checkEnum(raw.density, APPEARANCE_DENSITIES, "layout.density", issues)
  const railWidth = checkIntRange(raw, "railWidth", 180, 420, issues)
  const borderStyle = checkEnum(raw.borderStyle, APPEARANCE_BORDER_STYLES, "layout.borderStyle", issues)
  const statusBar = checkEnum(raw.statusBar, APPEARANCE_STATUS_BAR_MODES, "layout.statusBar", issues)
  return {
    ...(frame !== undefined ? { frame } : {}),
    ...(paneGap !== undefined ? { paneGap } : {}),
    ...(shellPadding !== undefined ? { shellPadding } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(radiusSm !== undefined ? { radiusSm } : {}),
    ...(radiusXs !== undefined ? { radiusXs } : {}),
    ...(density !== undefined ? { density } : {}),
    ...(railWidth !== undefined ? { railWidth } : {}),
    ...(borderStyle !== undefined ? { borderStyle } : {}),
    ...(statusBar !== undefined ? { statusBar } : {}),
  }
}

function validateFieldList(
  raw: unknown,
  slotId: AppearanceSlotId,
  path: string,
  issues: AppearanceValidationIssue[],
): readonly string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    issues.push({ path, message: `must be an array of field names (got ${typeLabel(raw)})` })
    return undefined
  }
  const allowed = new Set(SLOT_FIELDS[slotId])
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== "string") {
      issues.push({ path: `${path}[${i}]`, message: `field name must be a string (got ${typeLabel(item)})` })
      continue
    }
    if (!allowed.has(item)) {
      issues.push({
        path: `${path}[${i}]`,
        message: `unknown field "${item}" for slot "${slotId}" (valid fields: ${SLOT_FIELDS[slotId].join(", ")})`,
      })
      continue
    }
    if (seen.has(item)) {
      issues.push({ path: `${path}[${i}]`, message: `duplicate field "${item}"` })
      continue
    }
    seen.add(item)
    out.push(item)
  }
  return out
}

function validateSlotSpec(
  slotId: AppearanceSlotId,
  raw: unknown,
  issues: AppearanceValidationIssue[],
): AppearanceSlotSpec | undefined {
  const base = `slots.${slotId}`
  if (!isObject(raw)) {
    issues.push({ path: base, message: `must be an object (got ${typeLabel(raw)})` })
    return undefined
  }
  rejectUnknownKeys(raw, SLOT_SPEC_KEYS, base, issues)

  let component: string | undefined
  if (raw.component !== undefined) {
    if (typeof raw.component !== "string") {
      issues.push({
        path: `${base}.component`,
        message: `must be a relative path string (got ${typeLabel(raw.component)})`,
      })
    } else if (raw.component.split("/").includes("..") || !COMPONENT_PATH_RE.test(raw.component)) {
      issues.push({
        path: `${base}.component`,
        message: `must be a relative path under components/ ending in .tsx, .ts, .jsx, or .js without ".." (got "${raw.component}")`,
      })
    } else {
      component = raw.component
    }
  }

  let exportName: string | undefined
  if (raw.export !== undefined) {
    if (component === undefined && raw.component === undefined) {
      issues.push({ path: `${base}.export`, message: `"export" requires "component" to be set` })
    } else if (typeof raw.export !== "string" || !EXPORT_NAME_RE.test(raw.export)) {
      issues.push({ path: `${base}.export`, message: `must be a valid identifier (got ${JSON.stringify(raw.export)})` })
    } else {
      exportName = raw.export
    }
  }

  const fields = validateFieldList(raw.fields, slotId, `${base}.fields`, issues)
  const secondaryFields = validateFieldList(raw.secondaryFields, slotId, `${base}.secondaryFields`, issues)

  let tree: ModNode | undefined
  if (raw.tree !== undefined) {
    const res = validateModTree(raw.tree)
    if (!res.ok) issues.push({ path: `${base}.tree`, message: res.error })
    else tree = res.tree
  }

  let hidden: boolean | undefined
  if (raw.hidden !== undefined) {
    if (typeof raw.hidden !== "boolean") {
      issues.push({ path: `${base}.hidden`, message: `must be a boolean (got ${typeLabel(raw.hidden)})` })
    } else {
      hidden = raw.hidden
    }
  }

  const surface = checkEnum(raw.surface, APPEARANCE_SLOT_SURFACES, `${base}.surface`, issues)
  const variant = checkEnum(raw.variant, APPEARANCE_SLOT_VARIANTS, `${base}.variant`, issues)

  if (raw.component !== undefined && raw.tree !== undefined) {
    issues.push({ path: base, message: `cannot set both "component" and "tree" on the same slot` })
  }
  if (hidden === true && (raw.component !== undefined || raw.tree !== undefined)) {
    issues.push({ path: base, message: `cannot set "hidden: true" together with "component" or "tree"` })
  }

  return {
    ...(component !== undefined ? { component } : {}),
    ...(exportName !== undefined ? { export: exportName } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(secondaryFields !== undefined ? { secondaryFields } : {}),
    ...(tree !== undefined ? { tree } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
    ...(surface !== undefined ? { surface } : {}),
    ...(variant !== undefined ? { variant } : {}),
  }
}

/** Validate a parsed `appearance.json` object strictly, returning every error with its exact path. */
export function validateAppearanceManifest(raw: unknown): AppearanceValidateResult {
  if (!isObject(raw)) {
    const issue = { path: "", message: `manifest must be a JSON object at the top level (got ${typeLabel(raw)})` }
    return { ok: false, issues: [issue], summary: issue.message }
  }

  const issues: AppearanceValidationIssue[] = []
  rejectUnknownKeys(raw, TOP_KEYS, "", issues)

  if (raw.$schema !== undefined && typeof raw.$schema !== "string") {
    issues.push({ path: "$schema", message: `must be a string when present (got ${typeLabel(raw.$schema)})` })
  }
  if (raw.version !== APPEARANCE_SCHEMA_VERSION) {
    issues.push({
      path: "version",
      message: `must be ${APPEARANCE_SCHEMA_VERSION} (got ${JSON.stringify(raw.version)})`,
    })
  }

  let name = ""
  if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.trim().length > 64) {
    issues.push({ path: "name", message: "must be a non-empty string of at most 64 characters" })
  } else {
    name = raw.name.trim()
  }

  let description: string | undefined
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string" || raw.description.length > 240) {
      issues.push({ path: "description", message: "must be a string of at most 240 characters" })
    } else {
      description = raw.description
    }
  }

  let author: string | undefined
  if (raw.author !== undefined) {
    if (typeof raw.author !== "string" || raw.author.length > 80) {
      issues.push({ path: "author", message: "must be a string of at most 80 characters" })
    } else {
      author = raw.author
    }
  }

  let theme: string | undefined
  if (raw.theme !== undefined) {
    if (typeof raw.theme !== "string" || !APPEARANCE_NAME_RE.test(raw.theme)) {
      issues.push({
        path: "theme",
        message: `must be a valid theme name matching ${APPEARANCE_NAME_RE.source} (got ${JSON.stringify(raw.theme)})`,
      })
    } else {
      theme = raw.theme
    }
  }

  const colors = validateAppearanceColors(raw.colors, issues)
  const layout = validateLayout(raw.layout, issues)

  let slots: Partial<Record<AppearanceSlotId, AppearanceSlotSpec>> | undefined
  if (raw.slots !== undefined) {
    if (!isObject(raw.slots)) {
      issues.push({ path: "slots", message: `must be an object keyed by slot id (got ${typeLabel(raw.slots)})` })
    } else {
      slots = {}
      for (const [slotKey, spec] of Object.entries(raw.slots)) {
        if (!SLOT_SET.has(slotKey)) {
          issues.push({
            path: `slots.${slotKey}`,
            message: `unknown slot "${slotKey}" (valid slots: ${APPEARANCE_SLOTS.join(", ")})`,
          })
          continue
        }
        const validated = validateSlotSpec(slotKey as AppearanceSlotId, spec, issues)
        if (validated) slots[slotKey as AppearanceSlotId] = validated
      }
    }
  }

  if (issues.length > 0) {
    const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")
    return { ok: false, issues, summary }
  }

  return {
    ok: true,
    manifest: {
      ...(typeof raw.$schema === "string" ? { $schema: raw.$schema } : {}),
      version: APPEARANCE_SCHEMA_VERSION,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(theme !== undefined ? { theme } : {}),
      ...(colors !== undefined ? { colors } : {}),
      ...(layout !== undefined ? { layout } : {}),
      ...(slots !== undefined ? { slots } : {}),
    },
  }
}

/** Validate a pack directory slug (reserved `"default"` is disallowed for user packs). */
export function validateAppearancePackId(id: string): string | null {
  if (id === DEFAULT_APPEARANCE_PACK) return `"${DEFAULT_APPEARANCE_PACK}" is reserved for the built-in appearance`
  if (!APPEARANCE_NAME_RE.test(id)) {
    return `invalid appearance pack name "${id}" (use lowercase letters, digits, dot, underscore, hyphen; 1-64 chars)`
  }
  return null
}
