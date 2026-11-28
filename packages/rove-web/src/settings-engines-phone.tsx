/**
 * Settings → Engines on a phone: one grouped card, a row per engine (logo, name, status, its switch, `›`). A row opens
 * the engine's sheet: what Rove found, then Make default, Rename and Reset/Remove.
 */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { ts } from "./settings-copy.ts"
import { EngineFacts, EngineRename, type EngineSetting, type Run, TONE, health } from "./settings-engine-detail.tsx"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import { EngineIcon, type EngineIconData } from "./ui/engine-icon.tsx"
import { PhoneGroup } from "./ui/phone.tsx"
import {
  ENG_PHONE_CHEVRON,
  ENG_PHONE_DEFAULT,
  ENG_PHONE_NAME,
  ENG_PHONE_OPEN,
  ENG_PHONE_ROW,
  ENG_PHONE_TRAIL,
  ENG_SHEET_FACTS,
  ENG_SUB,
  ENG_TITLE,
  engDotClass,
  engStatusClass,
} from "./ui/settings.ts"
import { SHEET_LIST, SHEET_SEP, Sheet, SheetRow } from "./ui/sheet.tsx"
import { Switch } from "./ui/switch.tsx"

export function EnginesPhone(props: {
  engines: readonly EngineSetting[]
  icons: ReadonlyMap<string, EngineIconData>
  run: Run
}) {
  const [open, setOpen] = useState<string | null>(null)
  const opened = props.engines.find((e) => e.id === open)
  return (
    <>
      <PhoneGroup>
        {props.engines.map((e) => (
          <EngineRow key={e.id} engine={e} icon={props.icons.get(e.id)} run={props.run} onOpen={() => setOpen(e.id)} />
        ))}
      </PhoneGroup>
      {opened && <EngineSheet engine={opened} run={props.run} onClose={() => setOpen(null)} />}
    </>
  )
}

function EngineRow(props: { engine: EngineSetting; icon: EngineIconData | undefined; run: Run; onOpen: () => void }) {
  const { engine: e, run } = props
  const tone = TONE[health(e).tone]
  return (
    <div className={ENG_PHONE_ROW}>
      <Button variant="row" className={ENG_PHONE_OPEN} aria-haspopup="dialog" onClick={props.onOpen}>
        <EngineIcon icon={props.icon} />
        <span className={ENG_TITLE}>
          <span className={ENG_PHONE_NAME}>
            {e.name}
            {e.renamedFrom ? <span className={ENG_SUB}>{e.renamedFrom}</span> : null}
            {e.custom && !e.renamedFrom ? <span className={ENG_SUB}>{ts("engines.customTag")}</span> : null}
          </span>
          <span className={engStatusClass(tone)}>
            <span className={engDotClass(tone)} aria-hidden="true" />
            {ts(health(e).key.slice("settings.".length))}
            {e.isDefault && <span className={ENG_PHONE_DEFAULT}>· {ts("engines.defaultMark")}</span>}
          </span>
        </span>
      </Button>
      {/* An engine Rove cannot start has nothing to switch on. */}
      {e.binaryFound !== false && (
        <span className={ENG_PHONE_TRAIL}>
          <Switch
            on={e.enabled}
            aria-label={t("settings.engines.enabled", { name: e.name })}
            onClick={() => run("engine.setEnabled", { id: e.id, enabled: !e.enabled })}
          />
        </span>
      )}
      <Chevron right className={ENG_PHONE_CHEVRON} />
    </div>
  )
}

function EngineSheet(props: { engine: EngineSetting; run: Run; onClose: () => void }) {
  const { engine: e, run } = props
  const [renaming, setRenaming] = useState(false)
  const canDefault = !e.isDefault && e.canBeDefault && e.binaryFound !== false
  return (
    <Sheet label={e.name} title={e.name} onClose={props.onClose}>
      {(close) => (
        <div className={SHEET_LIST}>
          <div className={ENG_SHEET_FACTS}>
            <EngineFacts engine={e} />
          </div>
          {renaming ? (
            <div className={ENG_SHEET_FACTS}>
              <EngineRename
                name={e.name}
                onCancel={() => setRenaming(false)}
                onSave={(name) => {
                  run("engine.rename", { id: e.id, name })
                  setRenaming(false)
                }}
              />
            </div>
          ) : (
            <>
              <hr className={SHEET_SEP} />
              {canDefault && (
                <SheetRow
                  onClick={() => {
                    run("engine.setDefault", { id: e.id })
                    close()
                  }}
                >
                  {ts("engines.makeDefault")}
                </SheetRow>
              )}
              <SheetRow onClick={() => setRenaming(true)}>{t("settings.engines.rename")}</SheetRow>
              {(e.custom || e.customized) && (
                <SheetRow
                  tone={e.custom ? "danger" : "ink"}
                  onClick={() => {
                    run("engine.reset", { id: e.id })
                    close()
                  }}
                >
                  {e.custom ? t("settings.engines.remove") : t("settings.engines.reset")}
                </SheetRow>
              )}
              <hr className={SHEET_SEP} />
              <SheetRow tone="cancel" onClick={close}>
                {t("menu.cancel")}
              </SheetRow>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
