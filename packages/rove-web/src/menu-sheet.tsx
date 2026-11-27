/** A phone's menu: the same entries as the anchored one, as rows of a sheet rising from the bottom (iOS's action sheet). */

import { Fragment, useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import { type MenuItem, type MenuState, menu } from "./ui.ts"
import { Chevron } from "./ui/chevron.tsx"
import { SHEET_LIST, SHEET_SEP, Sheet, SheetCheck, SheetRow } from "./ui/sheet.tsx"

/** An entry with choices (`Set status ›`) opens them in place of the list; the first row leads back. */
export function MenuSheet({ state }: { state: MenuState }) {
  const [sub, setSub] = useState<MenuItem | null>(null)
  useEffect(() => {
    setSub(null)
    const target = state.target
    target?.setAttribute("data-menu-open", "")
    return () => target?.removeAttribute("data-menu-open")
  }, [state])
  const items = sub?.children ?? state.items
  return (
    <Sheet label={sub?.label ?? (state.target?.textContent?.trim() || t("menu.more"))} onClose={() => menu.set(null)}>
      {(close) => {
        const pick = (item: MenuItem) => {
          if (item.children) return setSub(item)
          close()
          item.run?.()
        }
        return (
          <div className={SHEET_LIST} role="menu">
            {sub && (
              <SheetRow tone="muted" onClick={() => setSub(null)}>
                <Chevron className="rotate-90" />
                <span className="min-w-0 truncate">{sub.label}</span>
              </SheetRow>
            )}
            {items.map((item, i) => (
              <Fragment key={item.label}>
                {(sub ? i === 0 : i > 0 && item.section !== items[i - 1]?.section) && <hr className={SHEET_SEP} />}
                <SheetRow
                  tone={item.danger ? "danger" : "ink"}
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  aria-haspopup={item.children ? "menu" : undefined}
                  onClick={() => pick(item)}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.children ? <Chevron right className="ml-auto text-subtle" /> : item.checked && <SheetCheck />}
                </SheetRow>
              </Fragment>
            ))}
            <hr className={SHEET_SEP} />
            <SheetRow tone="cancel" onClick={close}>
              {t("menu.cancel")}
            </SheetRow>
          </div>
        )
      }}
    </Sheet>
  )
}
