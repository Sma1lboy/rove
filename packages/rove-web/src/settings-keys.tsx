/**
 * Settings → Keybindings (TUI `KeybindingsSettingsSection`): the prefix-tap guide mode, the
 * config file, every load warning, the starter-file action offered while the file is absent, a
 * Scratch session whose agent edits the file, and every rebindable binding as a row to record,
 * restore or unbind (`settings-keys-editor.tsx`). The file is read and written on the Mac and
 * reread each time this opens.
 */

import { FIXED_BINDING_IDS } from "@sma1lboy/rove/src/tui/lib/keymap-overrides.ts"
import { useEffect, useState } from "react"
import { askAgent } from "./ask-agent.ts"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { BindingsEditor } from "./settings-keys-editor.tsx"
import { Choice, Group, Row } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { SETTINGS_GROUP_HINT } from "./ui/settings.ts"
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

export function KeysSection({ model }: { model: AppModel }) {
  const { client } = model
  const { prefs } = usePrefs()
  const keys = useStore(userKeys)
  const [askFailed, setAskFailed] = useState(false)
  // The file may have changed since the page loaded (an agent's edit, a hand edit); reading it is cheap.
  useEffect(() => void loadUserKeys(client), [client])
  const prefix = keys.prefix.key ?? ts("keybindings.prefixDisabled")
  const fixed = Object.keys(FIXED_BINDING_IDS).sort()
  return (
    <>
      <Group>
        <Choice
          label={ts("keybindings.tapPresentation")}
          hint={ts("keybindings.tapPresentationHint")}
          value={prefs.prefixTap}
          picks={[
            { value: "local", label: ts("keybindings.tapPresentationLocal") },
            { value: "guide", label: ts("keybindings.tapPresentationGuide") },
          ]}
          onPick={(next) => void setPref(client, "prefixTap", next)}
        />
        <Row
          label={ts("keybindings.prefixTitle", { prefix })}
          hint={ts("keybindings.prefixHint", { prefix, timeout: keys.prefix.timeoutMs })}
        />
      </Group>
      <Group title={ts("keybindings.configFile")} hint={`${t("keys.editHint")} ${t("prefs.keysYaml")}`}>
        <Row
          label={
            <span className="font-mono break-all">{keys.path + (keys.exists ? "" : ts("keybindings.notCreated"))}</span>
          }
        />
        {!keys.exists && (
          <Row label={t("keys.createFile")} hint={ts("keybindings.createHint")}>
            <Button variant="action" onClick={() => void createFile(client)}>
              {t("keys.createFile")}
            </Button>
          </Row>
        )}
        <Row label={t("keys.agent")} hint={askFailed ? t("keys.agentFailed") : t("keys.agentHint")}>
          <Button
            variant="action"
            onClick={() => {
              setAskFailed(false)
              askAgent(model, t("keys.agentPrompt", { path: keys.path })).catch(() => setAskFailed(true))
            }}
          >
            {t("keys.agent")}
          </Button>
        </Row>
      </Group>
      {keys.warnings.length > 0 && (
        <Group title={ts("keybindings.warnings")}>
          {keys.warnings.map((w) => (
            <Row key={w} label={<span className="text-warning">{w}</span>} />
          ))}
        </Group>
      )}
      <BindingsEditor client={client} />
      {keys.plugins.length > 0 && (
        <Group title={t("keys.pluginChords")}>
          {keys.plugins.map((p) => (
            <Row
              key={p.chord}
              label={<span className="font-mono">{p.chord}</span>}
              hint={<span className="font-mono">{`${p.kind}:${p.target}`}</span>}
            />
          ))}
        </Group>
      )}
      <p className={SETTINGS_GROUP_HINT}>{ts("keybindings.fixed", { ids: fixed.join(", ") })}</p>
    </>
  )
}
