/**
 * Browser runtime for appearance packs: registers the shared host React/UI
 * bridge on `globalThis.__ROVE_APPEARANCE_HOST__`, loads `~/.rove/appearances/`
 * metadata via `appearance.list`, dynamically imports custom component bundles
 * from the bridge on connect / hard refresh, and tracks every load or render
 * error so broken packs fall back to default UI instead of blanking the screen.
 */

import type {
  AppearanceManifest,
  AppearanceSlotId,
  AppearanceSlotSpec,
  AppearanceValidationIssue,
  SlotDataMap,
} from "@sma1lboy/rove-client/appearance/index.ts"
import { DEFAULT_APPEARANCE_PACK } from "@sma1lboy/rove-client/appearance/index.ts"
import * as React from "react"
import type { ComponentType, ReactNode } from "react"
import * as jsxRuntime from "react/jsx-runtime"
import type { BridgeClient } from "../bridge.ts"
import { createStore, useStore } from "../store.ts"
import { Button } from "../ui/button.tsx"
import { Chevron } from "../ui/chevron.tsx"
import { Chip } from "../ui/chip.tsx"
import { EngineIcon } from "../ui/engine-icon.tsx"
import { StatusDots } from "../ui/status-dots.tsx"

export interface AppearanceBundleError {
  readonly id: string
  readonly file: string
  readonly slot?: AppearanceSlotId
  readonly line?: number
  readonly column?: number
  readonly message: string
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

export interface AppearancePackSummary {
  readonly id: string
  readonly manifest: AppearanceManifest
  readonly fingerprint: string
  readonly hasComponents: boolean
  readonly bundleUrl: string | null
  readonly bundleError?: AppearanceBundleError
}

export interface AppearanceListReply {
  readonly dir: string
  readonly active: string
  readonly packs: readonly AppearancePackSummary[]
  readonly errors: readonly AppearancePackFailure[]
}

export interface AppearanceRuntimeError {
  readonly packId: string
  readonly phase: "manifest" | "bundle" | "import" | "render" | "missing" | "shell"
  readonly file?: string
  readonly slot?: AppearanceSlotId
  readonly message: string
  readonly stack?: string
  readonly issues?: readonly AppearanceValidationIssue[]
  readonly timestamp: number
}

export interface AppearanceSlotComponentProps<K extends AppearanceSlotId = AppearanceSlotId> {
  readonly slot: K
  readonly data: SlotDataMap[K]
  readonly defaultNode: ReactNode
  readonly children?: ReactNode
  readonly spec: AppearanceSlotSpec
  readonly tokens: Readonly<Record<string, string>>
  readonly mode: "dark" | "light"
}

export type SlotComponentMap = Readonly<
  Partial<{ [K in AppearanceSlotId]: ComponentType<AppearanceSlotComponentProps<K>> }>
>

export interface AppearanceState {
  readonly loaded: boolean
  readonly dir: string
  readonly activeId: string
  readonly activePack: AppearancePackSummary | null
  readonly packs: readonly AppearancePackSummary[]
  readonly loadErrors: readonly AppearancePackFailure[]
  readonly slotComponents: SlotComponentMap
  readonly runtimeErrors: readonly AppearanceRuntimeError[]
  readonly disabledByCrash: boolean
}

const INITIAL_STATE: AppearanceState = {
  loaded: false,
  dir: "",
  activeId: DEFAULT_APPEARANCE_PACK,
  activePack: null,
  packs: [],
  loadErrors: [],
  slotComponents: {},
  runtimeErrors: [],
  disabledByCrash: false,
}

export const appearanceStore = createStore<AppearanceState>(INITIAL_STATE)

/** Current resolved CSS tokens for custom components (`@rove/appearance`). */
export const appearanceTokensStore = createStore<Readonly<Record<string, string>>>({})

const PAGE_BOOT_NONCE = String(Date.now())

function readHostTokens(): Readonly<Record<string, string>> {
  return appearanceTokensStore.get()
}

function useHostTokens(): Readonly<Record<string, string>> {
  return useStore(appearanceTokensStore)
}

/** Expose one frozen React + UI host bridge so bundled pack components share our React instance. */
export function ensureAppearanceHostGlobal(): void {
  const g = globalThis as Record<string, unknown>
  if (g.__ROVE_APPEARANCE_HOST__) return
  g.__ROVE_APPEARANCE_HOST__ = Object.freeze({
    React,
    jsxRuntime,
    ui: Object.freeze({ Button, Chip, StatusDots, EngineIcon, Chevron }),
    getTokens: readHostTokens,
    useTokens: useHostTokens,
  })
}

ensureAppearanceHostGlobal()

let loadedBundleKey = ""
let cachedSlots: SlotComponentMap = {}

async function importPackComponents(pack: AppearancePackSummary): Promise<{
  slots: SlotComponentMap
  error?: AppearanceRuntimeError
}> {
  if (!pack.hasComponents || !pack.bundleUrl) return { slots: {} }
  const key = `${pack.id}@${pack.fingerprint}`
  if (loadedBundleKey === key) return { slots: cachedSlots }

  ensureAppearanceHostGlobal()
  const sep = pack.bundleUrl.includes("?") ? "&" : "?"
  const url = `${pack.bundleUrl}${sep}boot=${PAGE_BOOT_NONCE}`
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { slots?: unknown }
    if (!mod || typeof mod.slots !== "object" || mod.slots === null) {
      return {
        slots: {},
        error: {
          packId: pack.id,
          phase: "import",
          file: pack.bundleUrl,
          message: "appearance bundle exported no slots map",
          timestamp: Date.now(),
        },
      }
    }
    const rawSlots = mod.slots as Record<string, unknown>
    const validated: Record<string, ComponentType<AppearanceSlotComponentProps>> = {}
    for (const [slotId, comp] of Object.entries(rawSlots)) {
      if (typeof comp !== "function") {
        const spec = pack.manifest.slots?.[slotId as AppearanceSlotId]
        return {
          slots: {},
          error: {
            packId: pack.id,
            phase: "import",
            slot: slotId as AppearanceSlotId,
            file: spec?.component ?? pack.bundleUrl,
            message: `slot "${slotId}" export "${spec?.export ?? "default"}" is not a React component function`,
            timestamp: Date.now(),
          },
        }
      }
      validated[slotId] = comp as ComponentType<AppearanceSlotComponentProps>
    }
    loadedBundleKey = key
    cachedSlots = validated as SlotComponentMap
    return { slots: cachedSlots }
  } catch (err) {
    return {
      slots: {},
      error: {
        packId: pack.id,
        phase: "import",
        file: pack.bundleUrl,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        timestamp: Date.now(),
      },
    }
  }
}

async function applyListReply(reply: AppearanceListReply): Promise<void> {
  const activeId = reply.active || DEFAULT_APPEARANCE_PACK
  if (activeId === DEFAULT_APPEARANCE_PACK) {
    loadedBundleKey = ""
    cachedSlots = {}
    appearanceStore.set({
      loaded: true,
      dir: reply.dir,
      activeId,
      activePack: null,
      packs: reply.packs,
      loadErrors: reply.errors,
      slotComponents: {},
      runtimeErrors: [],
      disabledByCrash: false,
    })
    return
  }

  const manifestErr = reply.errors.find((e) => e.id === activeId)
  if (manifestErr) {
    appearanceStore.set({
      loaded: true,
      dir: reply.dir,
      activeId,
      activePack: null,
      packs: reply.packs,
      loadErrors: reply.errors,
      slotComponents: {},
      runtimeErrors: [
        {
          packId: activeId,
          phase: "manifest",
          file: manifestErr.file,
          slot: manifestErr.slot,
          message: manifestErr.message,
          issues: manifestErr.issues,
          timestamp: Date.now(),
        },
      ],
      disabledByCrash: false,
    })
    return
  }

  const pack = reply.packs.find((p) => p.id === activeId) ?? null
  if (!pack) {
    appearanceStore.set({
      loaded: true,
      dir: reply.dir,
      activeId,
      activePack: null,
      packs: reply.packs,
      loadErrors: reply.errors,
      slotComponents: {},
      runtimeErrors: [
        {
          packId: activeId,
          phase: "missing",
          file: "appearance.json",
          message: `selected appearance pack "${activeId}" was not found in ${reply.dir}`,
          timestamp: Date.now(),
        },
      ],
      disabledByCrash: false,
    })
    return
  }

  if (pack.bundleError) {
    const lineInfo = pack.bundleError.line ? `:${pack.bundleError.line}` : ""
    appearanceStore.set({
      loaded: true,
      dir: reply.dir,
      activeId,
      activePack: null,
      packs: reply.packs,
      loadErrors: reply.errors,
      slotComponents: {},
      runtimeErrors: [
        {
          packId: activeId,
          phase: "bundle",
          file: `${pack.bundleError.file}${lineInfo}`,
          slot: pack.bundleError.slot,
          message: pack.bundleError.message,
          timestamp: Date.now(),
        },
      ],
      disabledByCrash: false,
    })
    return
  }

  const imported = await importPackComponents(pack)
  if (imported.error) {
    appearanceStore.set({
      loaded: true,
      dir: reply.dir,
      activeId,
      activePack: null,
      packs: reply.packs,
      loadErrors: reply.errors,
      slotComponents: {},
      runtimeErrors: [imported.error],
      disabledByCrash: false,
    })
    return
  }

  const prev = appearanceStore.get()
  const samePack = prev.activePack?.id === pack.id && prev.activePack?.fingerprint === pack.fingerprint
  const keptRenderErrors = samePack
    ? prev.runtimeErrors.filter((e) => e.packId === pack.id && (e.phase === "render" || e.phase === "shell"))
    : []

  appearanceStore.set({
    loaded: true,
    dir: reply.dir,
    activeId,
    activePack: samePack && prev.disabledByCrash ? null : pack,
    packs: reply.packs,
    loadErrors: reply.errors,
    slotComponents: samePack && prev.disabledByCrash ? {} : imported.slots,
    runtimeErrors: keptRenderErrors,
    disabledByCrash: samePack ? prev.disabledByCrash : false,
  })
}

/** Query the bridge for `~/.rove/appearances/` and load the active pack's components. */
export async function loadAppearances(client: BridgeClient): Promise<void> {
  const reply = await client.request<AppearanceListReply>("appearance.list")
  await applyListReply(reply)
}

export async function selectAppearancePack(client: BridgeClient, id: string): Promise<void> {
  loadedBundleKey = ""
  cachedSlots = {}
  const reply = await client.request<AppearanceListReply>("appearance.set", { id })
  await applyListReply(reply)
}

export async function resetAppearanceToDefault(client: BridgeClient): Promise<void> {
  await selectAppearancePack(client, DEFAULT_APPEARANCE_PACK)
}

/** Record a per-slot render failure so only that slot falls back and Settings shows the stack. */
export function reportSlotCrash(
  packId: string,
  slot: AppearanceSlotId,
  file: string | undefined,
  error: Error,
  componentStack?: string,
): void {
  const cur = appearanceStore.get()
  const stack = [error.stack, componentStack].filter(Boolean).join("\n")
  const duplicate = cur.runtimeErrors.some(
    (e) => e.packId === packId && e.slot === slot && e.phase === "render" && e.message === error.message,
  )
  if (duplicate) return
  appearanceStore.set({
    ...cur,
    runtimeErrors: [
      ...cur.runtimeErrors,
      {
        packId,
        phase: "render",
        slot,
        file,
        message: error.message,
        stack,
        timestamp: Date.now(),
      },
    ],
  })
}

/** Disable the active pack after an uncaught shell-level crash so the app re-renders cleanly in default UI. */
export function disableAppearanceAfterCrash(error: Error, componentStack?: string): void {
  const cur = appearanceStore.get()
  const stack = [error.stack, componentStack].filter(Boolean).join("\n")
  appearanceStore.set({
    ...cur,
    activePack: null,
    slotComponents: {},
    disabledByCrash: true,
    runtimeErrors: [
      ...cur.runtimeErrors,
      {
        packId: cur.activeId,
        phase: "shell",
        message: error.message,
        stack,
        timestamp: Date.now(),
      },
    ],
  })
}

export function useAppearance(): AppearanceState {
  return useStore(appearanceStore)
}

export function useActiveAppearancePack(): AppearancePackSummary | null {
  const state = useStore(appearanceStore)
  return state.disabledByCrash ? null : state.activePack
}

export function useSlotSpec(slot: AppearanceSlotId): AppearanceSlotSpec | undefined {
  const pack = useActiveAppearancePack()
  return pack?.manifest.slots?.[slot]
}
