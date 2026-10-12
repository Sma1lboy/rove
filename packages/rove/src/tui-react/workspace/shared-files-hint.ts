import { formatChord } from "../../tui/lib/chord-glyphs"
import { legendCap } from "../../tui/lib/help-groups"
import type { KVContext } from "../context/kv"

export function showSharedFilesHint(
  kv: Pick<KVContext, "get" | "setQuiet">,
  notify: (title: string, body: string) => void,
  t: (key: string, params: Record<string, string>) => string,
): void {
  if (kv.get("onboarding.sharedFilesHintSeen", false)) return
  kv.setQuiet("onboarding.sharedFilesHintSeen", true)
  notify(t("onboarding.tabShared", {}), t("onboarding.tabIsolated", { key: formatChord(legendCap("task.new") ?? "n") }))
}
