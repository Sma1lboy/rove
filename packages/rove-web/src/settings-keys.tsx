/**
 * Settings → Keybindings (TUI `KeybindingsSettingsSection`): the prefix-tap guide mode, the
 * config file and what it changed, every load warning, and the starter-file action offered
 * while the file is absent. The file is read and written on the Mac; chords are edited there.
 */

import { FIXED_BINDING_IDS } from "@sma1lboy/rove/src/tui/lib/keymap-overrides.ts"
import { useEffect } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Chips, CycleRow, Group } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { toast } from "./ui.ts"
import { PREF_FIELD, PREF_HINT, PREF_LABEL } from "./ui/settings.ts"
import { MONO } from "./ui/text.ts"
import { loadUserKeys, userKeys } from "./user-keys.ts"

async function createFile(client: BridgeClient): Promise<void> {
  try {
    const res = await client.request<{ created: boolean }>("keybindings.createFile")
    if (!res.created) toast(t("keys.exists"), "error")
    await loadUserKeys(client)
  } catch (err) {
    toast(errorText(err), "error")
  }
}

export function KeysSection({ client }: { client: BridgeClient }) {
  const { prefs } = usePrefs()
  const keys = useStore(userKeys)
  // The file may have changed since the page loaded; reading it is cheap.
  useEffect(() => void loadUserKeys(client), [client])
  const prefix = keys.prefix.key ?? ts("keybindings.prefixDisabled")
  const fixed = Object.keys(FIXED_BINDING_IDS).sort()
  return (
    <Group title={ts("keybindings.title")} hint={ts("keybindings.hint")}>
      <div className={PREF_FIELD}>
        <span className={PREF_LABEL}>{ts("keybindings.configFile")}</span>
        <p className={`${MONO} text-muted`}>{keys.path + (keys.exists ? "" : ts("keybindings.notCreated"))}</p>
      </div>
      <Chips
        label={ts("keybindings.tapPresentation")}
        hint={ts("keybindings.tapPresentationHint")}
        value={prefs.prefixTap}
        picks={[
          { value: "local", label: ts("keybindings.tapPresentationLocal") },
          { value: "guide", label: ts("keybindings.tapPresentationGuide") },
        ]}
        onPick={(next) => void setPref(client, "prefixTap", next)}
      />
      <div className={PREF_FIELD}>
        <span className={PREF_LABEL}>{ts("keybindings.prefixTitle", { prefix })}</span>
        <p className={`${PREF_HINT} text-muted`}>
          {ts("keybindings.prefixHint", { prefix, timeout: keys.prefix.timeoutMs })}
        </p>
      </div>
      {keys.exists ? (
        <div className={PREF_FIELD}>
          <span className={PREF_LABEL}>{ts("keybindings.overridesApplied")}</span>
          {keys.applied.length === 0 && <p className="text-muted">{ts("keybindings.none")}</p>}
          {keys.applied.map((o) => (
            <p key={o.id} className={`${MONO} keys-applied`}>
              {`${o.id}  ${o.keys.length > 0 ? o.keys.join(" / ") : ts("keybindings.unbound")}  (${ts("keybindings.defaultKeys", { keys: o.defaultKeys.join(" / ") })})`}
            </p>
          ))}
        </div>
      ) : (
        <div className={PREF_FIELD}>
          <p className="text-muted">{ts("keybindings.createHint")}</p>
          <CycleRow label={t("keys.createFile")} onCycle={() => void createFile(client)} />
        </div>
      )}
      {keys.warnings.length > 0 && (
        <div className={PREF_FIELD}>
          <span className={`${PREF_LABEL} text-warning`}>{ts("keybindings.warnings")}</span>
          {keys.warnings.map((w) => (
            <p key={w} className={`${MONO} text-muted`}>{`! ${w}`}</p>
          ))}
        </div>
      )}
      <p className="text-muted">{ts("keybindings.fixed", { ids: fixed.join(", ") })}</p>
      <p className="text-muted">{t("prefs.keysYaml")}</p>
    </Group>
  )
}
