/**
 * Settings → Keybindings (TUI `KeybindingsSettingsSection`): the prefix-tap guide mode, the
 * config file, every load warning, a
 * Scratch session whose agent edits the file, and every rebindable binding as a row to record,
 * restore or unbind (`settings-keys-editor.tsx`). The file is read and written on the Mac and
 * reread each time this opens.
 */

import { PREFIX_KEY_ID } from "@sma1lboy/rove/src/tui/lib/chord-recorder.ts"
import { useEffect, useState } from "react"
import { askAgent } from "./ask-agent.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { BindingCaps, BindingRows, bindingHint, useBindingEditor } from "./settings-keys-editor.tsx"
import { Choice, Group, Row } from "./settings-rows.tsx"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import { DEFAULT_USER_KEYS, loadUserKeys, userKeys } from "./user-keys.ts"

export function KeysSection({ model }: { model: AppModel }) {
  const { client } = model
  const { prefs } = usePrefs()
  const keys = useStore(userKeys)
  const [askFailed, setAskFailed] = useState(false)
  // The file may have changed since the page loaded (an agent's edit, a hand edit); reading it is cheap.
  useEffect(() => void loadUserKeys(client), [client])
  const prefix = keys.prefix.key ?? ts("keybindings.prefixDisabled")
  const editor = useBindingEditor(client)
  const defaultPrefix = DEFAULT_USER_KEYS.prefix.firstStrokes
  const prefixChanged = keys.prefix.firstStrokes.join() !== defaultPrefix.join()
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
          hint={bindingHint(
            editor,
            PREFIX_KEY_ID,
            prefixChanged ? defaultPrefix.join(" / ") : null,
            ts("keybindings.prefixHint", { prefix, timeout: keys.prefix.timeoutMs }),
          )}
        >
          <BindingCaps
            editor={editor}
            id={PREFIX_KEY_ID}
            name={ts("keybindings.prefixKey")}
            direct={keys.prefix.firstStrokes}
            prefixName={prefix}
            changed={prefixChanged}
          />
        </Row>
      </Group>
      <Group title={ts("keybindings.configFile")} hint={`${t("keys.editHint")} ${t("prefs.keysYaml")}`}>
        <Row
          label={
            <span className="font-mono break-all">{keys.path + (keys.exists ? "" : ts("keybindings.notCreated"))}</span>
          }
        />
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
      <BindingRows editor={editor} keys={keys} />
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
    </>
  )
}
