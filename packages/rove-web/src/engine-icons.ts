/** Each engine's brand mark by engine id, from the registry (`engines.list`): the rail never names a vendor. */

import { useEffect, useState } from "react"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import type { EngineIconData } from "./ui/engine-icon.tsx"

type Reply = { engines: readonly { readonly id: string; readonly icon?: EngineIconData }[] }

const byId = (reply: Reply | undefined): ReadonlyMap<string, EngineIconData> =>
  new Map((reply?.engines ?? []).flatMap((e) => (e.icon ? [[e.id, e.icon] as const] : [])))

// ponytail: read once per connection; an engine added in Settings gets its mark on the next reload.
export function useEngineIcons(model: AppModel): ReadonlyMap<string, EngineIconData> {
  const [icons, setIcons] = useState(() => byId(lastReply<Reply>(model, "engines.list")))
  // The first task list is the sign the socket is up: a request before it is refused.
  const connected = useStore(model.tasks) !== null
  useEffect(() => {
    if (!connected) return
    requestRemembered<Reply>(model, "engines.list")
      .then((reply) => setIcons(byId(reply)))
      .catch(() => {})
  }, [model, connected])
  return icons
}
