/**
 * Bundles an appearance pack's custom `components/*.tsx|ts|jsx|js` files on demand
 * with `Bun.build` so rove-web can `import()` them from the bridge's own origin
 * under strict `script-src 'self'` CSP, sharing the host's single React instance.
 */

import { existsSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import {
  type LoadedAppearancePack,
  loadAppearancePack,
  userAppearancesDir,
} from "@sma1lboy/rove-client/appearance/loader.ts"
import { validateAppearancePackId } from "@sma1lboy/rove-client/appearance/manifest.ts"
import type { AppearanceSlotId } from "@sma1lboy/rove-client/appearance/slots.ts"
import type { BunPlugin } from "bun"

export interface AppearanceBundleError {
  readonly id: string
  readonly file: string
  readonly slot?: AppearanceSlotId
  readonly line?: number
  readonly column?: number
  readonly message: string
}

export type AppearanceBundleResult =
  | { readonly ok: true; readonly code: string; readonly fingerprint: string }
  | { readonly ok: false; readonly error: AppearanceBundleError; readonly fingerprint: string }

const REACT_SHIM = `
const H = globalThis.__ROVE_APPEARANCE_HOST__;
if (!H || !H.React) throw new Error("Rove appearance host runtime is not initialized");
const R = H.React;
export default R;
export const {
  Children, Component, Fragment, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useReducer, useRef, useState, useSyncExternalStore, useTransition
} = R;
`

const JSX_RUNTIME_SHIM = `
const H = globalThis.__ROVE_APPEARANCE_HOST__;
if (!H || !H.jsxRuntime) throw new Error("Rove appearance JSX runtime is not initialized");
export const { Fragment, jsx, jsxs } = H.jsxRuntime;
export const jsxDEV = H.jsxRuntime.jsxDEV ?? H.jsxRuntime.jsx;
`

const HOST_SHIM = `
const H = globalThis.__ROVE_APPEARANCE_HOST__;
if (!H) throw new Error("Rove appearance host runtime is not initialized");
export const ui = H.ui;
export const getTokens = H.getTokens;
export const useTokens = H.useTokens;
export default H;
`

const VIRTUAL_ENTRY = "/__rove_appearance_entry__.ts"
const BUNDLE_PATH_RE = /^\/appearances\/([^/]+)\/bundle\.js$/

const bundleCache = new Map<string, AppearanceBundleResult>()

function buildEntrySource(pack: LoadedAppearancePack): string {
  const imports: string[] = []
  const pairs: string[] = []
  pack.components.forEach((comp, i) => {
    const ident = `slot_${i}`
    const spec = JSON.stringify(comp.absPath)
    if (comp.exportName === "default") {
      imports.push(`import ${ident} from ${spec}`)
    } else {
      imports.push(`import { ${comp.exportName} as ${ident} } from ${spec}`)
    }
    pairs.push(`  ${JSON.stringify(comp.slot)}: ${ident},`)
  })
  return [
    ...imports,
    "export const slots = {",
    ...pairs,
    "}",
    `export const meta = ${JSON.stringify({ id: pack.id, fingerprint: pack.fingerprint })}`,
    "",
  ].join("\n")
}

function hostPlugin(pack: LoadedAppearancePack, entrySource: string): BunPlugin {
  const packRoot = resolve(pack.dir)
  return {
    name: "rove-appearance-host",
    setup(build) {
      build.onResolve({ filter: /^\/__rove_appearance_entry__\.ts$/ }, () => ({
        path: VIRTUAL_ENTRY,
        namespace: "rove-ap-entry",
      }))
      build.onLoad({ filter: /.*/, namespace: "rove-ap-entry" }, () => ({
        contents: entrySource,
        loader: "ts",
      }))
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "rove-ap-shim" }))
      build.onResolve({ filter: /^react\/jsx-(?:dev-)?runtime$/ }, () => ({
        path: "react/jsx-runtime",
        namespace: "rove-ap-shim",
      }))
      build.onResolve({ filter: /^@rove\/appearance(?:-host)?$/ }, () => ({
        path: "@rove/appearance",
        namespace: "rove-ap-shim",
      }))
      build.onLoad({ filter: /.*/, namespace: "rove-ap-shim" }, (args) => {
        if (args.path === "react") return { contents: REACT_SHIM, loader: "js" }
        if (args.path === "react/jsx-runtime") return { contents: JSX_RUNTIME_SHIM, loader: "js" }
        return { contents: HOST_SHIM, loader: "js" }
      })
      // Keep relative imports strictly inside the pack directory.
      build.onResolve({ filter: /^\./ }, (args) => {
        if (!args.importer || args.namespace === "rove-ap-shim") return undefined
        const resolved = resolve(dirname(args.importer), args.path)
        if (resolved !== packRoot && !resolved.startsWith(packRoot + sep)) {
          throw new Error(`import "${args.path}" escapes the appearance pack directory`)
        }
        return undefined
      })
    },
  }
}

/** Compile all custom components of a pack into one browser ESM module, cached by fingerprint. */
export async function bundleAppearancePack(pack: LoadedAppearancePack): Promise<AppearanceBundleResult> {
  const cached = bundleCache.get(pack.id)
  if (cached && cached.fingerprint === pack.fingerprint) return cached

  if (pack.components.length === 0) {
    const empty: AppearanceBundleResult = {
      ok: true,
      fingerprint: pack.fingerprint,
      code: `export const slots = {}; export const meta = ${JSON.stringify({ id: pack.id, fingerprint: pack.fingerprint })};\n`,
    }
    bundleCache.set(pack.id, empty)
    return empty
  }

  const entrySource = buildEntrySource(pack)
  try {
    const built = await Bun.build({
      entrypoints: [VIRTUAL_ENTRY],
      target: "browser",
      format: "esm",
      minify: false,
      sourcemap: "inline",
      plugins: [hostPlugin(pack, entrySource)],
    })
    if (!built.success || built.outputs.length === 0) {
      const first = built.logs[0]
      const file = first?.position?.file
        ? first.position.file.replace(`${resolve(pack.dir)}${sep}`, "")
        : (pack.components[0]?.relPath ?? "appearance.json")
      const matched = pack.components.find((c) => c.relPath === file || c.absPath === first?.position?.file)
      const fail: AppearanceBundleResult = {
        ok: false,
        fingerprint: pack.fingerprint,
        error: {
          id: pack.id,
          file,
          ...(matched ? { slot: matched.slot } : {}),
          ...(first?.position?.line ? { line: first.position.line } : {}),
          ...(first?.position?.column ? { column: first.position.column } : {}),
          message:
            built.logs
              .map((l) => l.message)
              .filter(Boolean)
              .join("; ") || "failed to bundle appearance components",
        },
      }
      bundleCache.set(pack.id, fail)
      return fail
    }
    const code = await built.outputs[0].text()
    const ok: AppearanceBundleResult = { ok: true, code, fingerprint: pack.fingerprint }
    bundleCache.set(pack.id, ok)
    return ok
  } catch (err) {
    const fail: AppearanceBundleResult = {
      ok: false,
      fingerprint: pack.fingerprint,
      error: {
        id: pack.id,
        file: pack.components[0]?.relPath ?? "appearance.json",
        ...(pack.components[0] ? { slot: pack.components[0].slot } : {}),
        message: err instanceof Error ? err.message : String(err),
      },
    }
    bundleCache.set(pack.id, fail)
    return fail
  }
}

export function clearAppearanceBundleCache(): void {
  bundleCache.clear()
}

/**
 * Serve `GET /appearances/<id>/bundle.js` for same-origin dynamic `import()` in rove-web.
 * Returns null for any other path so static serving continues normally.
 */
export async function serveAppearanceBundle(req: Request, rootDir?: string): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url).pathname)
  } catch {
    return null
  }
  const match = BUNDLE_PATH_RE.exec(pathname)
  if (!match) return null
  const id = match[1] as string
  const bad = validateAppearancePackId(id)
  if (bad) return Response.json({ error: bad }, { status: 400, headers: { "Cache-Control": "no-store" } })

  const dir = join(rootDir ?? userAppearancesDir(), id)
  if (!existsSync(dir)) {
    return Response.json(
      { error: `appearance pack "${id}" not found` },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }
  const loaded = loadAppearancePack(dir, id)
  if (!loaded.ok) {
    return Response.json({ error: loaded.error }, { status: 422, headers: { "Cache-Control": "no-store" } })
  }
  const bundled = await bundleAppearancePack(loaded.pack)
  if (!bundled.ok) {
    return Response.json({ error: bundled.error }, { status: 422, headers: { "Cache-Control": "no-store" } })
  }
  return new Response(req.method === "HEAD" ? null : bundled.code, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
