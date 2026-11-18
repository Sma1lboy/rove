import type { BridgeClient } from "../bridge.ts"
import { daemonHealth, refreshRove } from "../daemon-health.tsx"
import { t, useLocale } from "../i18n/index.ts"
import { useStore } from "../store.ts"
import { prefixHint, userKeys } from "../user-keys.ts"
import { Button } from "./button.tsx"

export function RefreshRoveButton({ client, railBar }: { client: BridgeClient; railBar?: boolean }) {
  useLocale()
  useStore(userKeys)
  const { stale, bridgeVersion, daemonVersion } = useStore(daemonHealth)
  if (!stale) return null
  const label = t("layout.refreshRove")
  const versions = t("layout.refreshVersions", {
    bridge: bridgeVersion ? `v${bridgeVersion}` : t("layout.unknownVersion"),
    daemon: daemonVersion ? `v${daemonVersion}` : t("layout.unknownVersion"),
  })
  const hint = [versions, prefixHint("app.refresh")].filter(Boolean).join(" · ")
  const button = (
    <Button
      variant="pill"
      className="ml-auto min-h-6 min-w-6 justify-center touch:min-h-8 rounded-sm focus-visible:outline-1 focus-visible:outline-focus"
      aria-label={label}
      title={hint}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation()
      }}
      onClick={() => refreshRove(client)}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className={railBar ? "@max-[6.25rem]/refresh:sr-only" : undefined}>{label}</span>
    </Button>
  )
  if (!railBar) return button
  return (
    <div className="@container/refresh absolute top-2 right-2.5 left-[calc(5.75rem+var(--shell-inset-left,0px))] flex h-6.5 items-center justify-end @max-[13rem]:right-1">
      {button}
    </div>
  )
}
