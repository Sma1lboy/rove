/** A phone's way in to what extensions add: the installed first-party mods' pages and every open mod pane, one row each. */

import { t } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { useCopy } from "./pages-kit.ts"
import { extPages, lastExtPage, rememberExtPage } from "./phone-rows.ts"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import { PHONE_ROW, PhoneGroup, PhonePage } from "./ui/phone.tsx"

export function ExtensionsView({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const last = useStore(lastExtPage)
  const pages = extPages(useStore(model.installedMods), useStore(model.mods), nav)
  // The one opened last leads, so the button's second tap is always the same place.
  const ordered = [...pages].sort((a, b) => Number(b.id === last) - Number(a.id === last))
  return (
    <PhonePage title={t("rail.extensions")} note={t("rail.extensionsNote")}>
      {ordered.length > 0 && (
        <PhoneGroup>
          {ordered.map((entry) => (
            <Button
              key={entry.id}
              variant="row"
              className={PHONE_ROW}
              data-ext-row={entry.id}
              onClick={() => {
                rememberExtPage(entry)
                openPage(entry.page)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              <span className="flex-none font-mono text-meta text-subtle">
                {entry.id === last ? t("rail.lastOpened") : entry.note}
              </span>
            </Button>
          ))}
        </PhoneGroup>
      )}
    </PhonePage>
  )
}
