/**
 * Settings → Keybindings: the prefix-tap guide mode. Rebinding chords is an edit of
 * `~/.rove/settings/keybindings.yaml` on the Mac, which this page does not write.
 */

import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { setPref, usePrefs } from "./prefs.ts"
import { ts } from "./settings-copy.ts"
import { Chips, Group } from "./settings-rows.tsx"

export function KeysSection({ client }: { client: BridgeClient }) {
  const { prefs } = usePrefs()
  return (
    <Group title={ts("keybindings.title")}>
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
      <p className="muted">{t("prefs.keysYaml")}</p>
    </Group>
  )
}
