/**
 * Settings → Appearance → Appearance pack picker: lists built-in Default plus
 * every pack in `~/.rove/appearances/`, surfaces manifest/bundle/runtime errors
 * with stack traces, and offers one-click "Switch to default".
 */

import { DEFAULT_APPEARANCE_PACK } from "@sma1lboy/rove-client/appearance/index.ts"
import { useEffect } from "react"
import { t, useLocale } from "../i18n/index.ts"
import type { AppModel } from "../model.ts"
import { Row } from "../settings-rows.tsx"
import {
  AP_ERROR_BOX,
  AP_ERROR_STACK,
  AP_PACK_DESC,
  AP_PACK_GRID,
  AP_PACK_HEAD,
  AP_PACK_TAG,
  apPackCardClass,
} from "../ui/appearance.ts"
import { Button } from "../ui/button.tsx"
import { SETTINGS_NOTE, SETTINGS_VALUE } from "../ui/settings.ts"
import { loadAppearances, resetAppearanceToDefault, selectAppearancePack, useAppearance } from "./runtime.ts"

export function AppearancePacksSection({ model }: { readonly model: AppModel }) {
  useLocale()
  const { client } = model
  const state = useAppearance()

  // Re-read ~/.rove/appearances/ each time Settings opens so new/edited packs show immediately.
  useEffect(() => {
    void loadAppearances(client).catch(() => undefined)
  }, [client])

  const latestError = state.runtimeErrors[state.runtimeErrors.length - 1] ?? null

  return (
    <Row label={t("settings.appearance.packLabel")} hint={t("settings.appearance.packHint")} stack>
      <div className={AP_PACK_GRID} data-appearance-pack-grid>
        <Button
          variant="row"
          aria-pressed={state.activeId === DEFAULT_APPEARANCE_PACK}
          className={apPackCardClass(state.activeId === DEFAULT_APPEARANCE_PACK)}
          onClick={() => void selectAppearancePack(client, DEFAULT_APPEARANCE_PACK)}
          data-pack-id={DEFAULT_APPEARANCE_PACK}
        >
          <span className={AP_PACK_HEAD}>
            <span className="truncate">{t("settings.appearance.packDefault")}</span>
            <span className={AP_PACK_TAG}>{t("settings.appearance.packBuiltIn")}</span>
          </span>
          <span className={AP_PACK_DESC}>{t("settings.appearance.packDefaultDesc")}</span>
        </Button>

        {state.packs.map((pack) => {
          const active = state.activeId === pack.id
          const hasBundleErr = Boolean(pack.bundleError)
          return (
            <Button
              key={pack.id}
              variant="row"
              aria-pressed={active}
              className={apPackCardClass(active)}
              onClick={() => void selectAppearancePack(client, pack.id)}
              data-pack-id={pack.id}
            >
              <span className={AP_PACK_HEAD}>
                <span className="truncate">{pack.manifest.name}</span>
                <span className={AP_PACK_TAG}>
                  {hasBundleErr
                    ? t("settings.appearance.packTagError")
                    : pack.hasComponents
                      ? t("settings.appearance.packTagCustom")
                      : t("settings.appearance.packTagManifest")}
                </span>
              </span>
              {pack.manifest.description && <span className={AP_PACK_DESC}>{pack.manifest.description}</span>}
              {pack.bundleError && (
                <span className="truncate font-mono text-meta text-error">{pack.bundleError.message}</span>
              )}
            </Button>
          )
        })}
      </div>

      {state.dir && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={SETTINGS_NOTE}>{t("settings.appearance.packDirLabel")}</span>
          <span className={SETTINGS_VALUE}>{state.dir}</span>
        </div>
      )}

      {latestError && (
        <div className={AP_ERROR_BOX} data-appearance-last-error>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-error">
              {t("settings.appearance.packLastError", { pack: latestError.packId })}
              {latestError.slot ? ` · ${latestError.slot}` : ""}
              {latestError.file ? ` (${latestError.file})` : ""}
            </span>
            <Button variant="action" onClick={() => void resetAppearanceToDefault(client)}>
              {t("settings.appearance.packSwitchDefault")}
            </Button>
          </div>
          <p className="m-0 text-ink">{latestError.message}</p>
          {latestError.issues && latestError.issues.length > 0 && (
            <ul className="m-0 list-disc pl-4 text-muted">
              {latestError.issues.map((issue, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list of validation issues
                <li key={idx}>
                  {issue.path ? `${issue.path}: ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {latestError.stack && <pre className={AP_ERROR_STACK}>{latestError.stack}</pre>}
        </div>
      )}

      {state.loadErrors.length > 0 && (
        <div className="flex flex-col gap-1.5" data-appearance-load-errors>
          <span className={SETTINGS_NOTE}>{t("settings.appearance.packInvalidHeading")}</span>
          {state.loadErrors.map((err) => (
            <div key={err.id} className={AP_ERROR_BOX}>
              <span className="font-semibold text-error">
                {err.id} · {err.file}
                {err.slot ? ` (${err.slot})` : ""}
              </span>
              <span className="text-ink">{err.message}</span>
              <div className="flex items-center gap-2">
                <Button variant="link" onClick={() => void selectAppearancePack(client, err.id)}>
                  {t("settings.appearance.packTryActivate")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Row>
  )
}
