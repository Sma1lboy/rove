/**
 * Settings → Engines: one row per engine (name, a plain-language status, whether it is the
 * default, whether it is offered), the detection facts and rename/reset in a detail area that
 * opens under its row, one section for Rove's engine integrations (the activity hooks) and one
 * for the Rove agent skill. A phone shows the engines as a grouped card instead (`settings-engines-phone.tsx`).
 * Launch commands stay a Mac-side edit.
 */

import { useId, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { useEngineIcons } from "./engine-icons.ts"
import { t } from "./i18n/index.ts"
import { useNarrow } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { ts } from "./settings-copy.ts"
import { EngineFacts, EngineRename, type EngineSetting, type Run, TONE, health } from "./settings-engine-detail.tsx"
import { EnginesPhone } from "./settings-engines-phone.tsx"
import { Group, Row, SectionPending, useSectionReply } from "./settings-rows.tsx"
import { installSkill } from "./skill-status.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import {
  ENG_ACTIONS,
  ENG_DEFAULT,
  ENG_DETAIL_AREA,
  ENG_ITEM,
  ENG_LIST,
  ENG_LIST_HEAD,
  ENG_MAKE_DEFAULT,
  ENG_PILL,
  ENG_ROW,
  ENG_SUB,
  ENG_SUMMARY,
  ENG_TITLE,
  ENG_UPTODATE,
  engChevronClass,
  engDotClass,
  engNameClass,
  engStatusClass,
} from "./ui/settings.ts"
import { SETTINGS_ACTIONS, SETTINGS_GROUP_HINT } from "./ui/settings.ts"
import { Switch } from "./ui/switch.tsx"

export function EnginesSection({ model }: { model: AppModel }) {
  const { client } = model
  const narrow = useNarrow()
  const icons = useEngineIcons(model)
  const { value, failed, reload: load } = useSectionReply<{ engines: EngineSetting[] }>(client, "engines.settings")
  const engines = value?.engines
  const [open, setOpen] = useState<string | null>(null)
  const run: Run = (op, args = {}) =>
    void client
      .request(op, args)
      .then(load)
      .catch((e) => toast(errorText(e), "error"))
  if (!engines) return <SectionPending failed={failed} onRetry={load} />
  return (
    <>
      {narrow ? (
        <EnginesPhone engines={engines} icons={icons} run={run} />
      ) : (
        <section>
          <p className={SETTINGS_GROUP_HINT}>{ts("engines.hint")}</p>
          <div className={ENG_LIST}>
            <div className={ENG_LIST_HEAD} aria-hidden="true">
              <span />
              <span>{ts("engines.defaultMark")}</span>
              <span>{ts("engines.available")}</span>
            </div>
            {engines.map((e) => (
              <EngineItem
                key={e.id}
                engine={e}
                open={open === e.id}
                onToggleOpen={() => setOpen(open === e.id ? null : e.id)}
                run={run}
              />
            ))}
          </div>
        </section>
      )}
      <Integrations engines={engines} run={run} />
      <SkillSection engines={engines} client={client} reload={load} />
    </>
  )
}

function EngineItem(props: { engine: EngineSetting; open: boolean; onToggleOpen: () => void; run: Run }) {
  const { engine: e, run } = props
  const detailId = useId()
  const status = health(e)
  // An engine Rove cannot start has nothing to switch on or make the default.
  const missing = e.binaryFound === false
  return (
    <div className={ENG_ITEM}>
      <div className={ENG_ROW}>
        <button
          type="button"
          className={ENG_SUMMARY}
          aria-expanded={props.open}
          aria-controls={detailId}
          onClick={props.onToggleOpen}
        >
          <Chevron right={!props.open} className={engChevronClass(props.open)} />
          <span className={ENG_TITLE}>
            <span className={engNameClass(!e.enabled)}>
              {e.name}
              {e.renamedFrom ? <span className={ENG_SUB}>{e.renamedFrom}</span> : null}
              {e.custom && !e.renamedFrom ? <span className={ENG_SUB}>{ts("engines.customTag")}</span> : null}
            </span>
            <span className={engStatusClass(TONE[status.tone])}>
              <span className={engDotClass(TONE[status.tone])} aria-hidden="true" />
              {ts(status.key.slice("settings.".length))}
            </span>
          </span>
        </button>
        <div className={ENG_DEFAULT}>
          {e.isDefault ? (
            <span className={ENG_PILL}>{ts("engines.defaultMark")}</span>
          ) : e.canBeDefault && !missing ? (
            <button
              type="button"
              className={ENG_MAKE_DEFAULT}
              aria-label={t("settings.engines.default", { name: e.name })}
              onClick={() => run("engine.setDefault", { id: e.id })}
            >
              {ts("engines.makeDefault")}
            </button>
          ) : null}
        </div>
        {missing ? (
          <span />
        ) : (
          <Switch
            on={e.enabled}
            aria-label={t("settings.engines.enabled", { name: e.name })}
            onClick={() => run("engine.setEnabled", { id: e.id, enabled: !e.enabled })}
          />
        )}
      </div>
      {props.open ? <EngineDetail id={detailId} engine={e} run={run} /> : null}
    </div>
  )
}

function EngineDetail(props: { id: string; engine: EngineSetting; run: Run }) {
  const { engine: e, run } = props
  const [renaming, setRenaming] = useState(false)
  return (
    <div id={props.id} className={ENG_DETAIL_AREA}>
      <EngineFacts engine={e} />
      {renaming ? (
        <EngineRename
          name={e.name}
          onCancel={() => setRenaming(false)}
          onSave={(name) => {
            run("engine.rename", { id: e.id, name })
            setRenaming(false)
          }}
        />
      ) : (
        <div className={ENG_ACTIONS}>
          <Button variant="action" onClick={() => setRenaming(true)}>
            {t("settings.engines.rename")}
          </Button>
          {e.custom || e.customized ? (
            <Button variant="action" onClick={() => run("engine.reset", { id: e.id })}>
              {e.custom ? t("settings.engines.remove") : t("settings.engines.reset")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Integrations({ engines, run }: { engines: readonly EngineSetting[]; run: Run }) {
  const hooked = engines.filter((e) => e.hooks !== "unsupported")
  // An engine whose CLI is not on this machine has nothing to install into.
  const hookable = hooked.filter((e) => e.binaryFound !== false)
  const current = hookable.filter((e) => e.hooks === "installed").length
  const needInstall = hookable.length - current
  const onDisk = hooked.filter((e) => e.hooks !== "not-installed").length
  if (hooked.length === 0) return null
  return (
    <Group title={ts("engines.integrations.title")} hint={ts("engines.integrations.hint")}>
      <Row label={ts("engines.integrations.summary", { installed: current, total: hookable.length })}>
        <div className={SETTINGS_ACTIONS}>
          {needInstall > 0 ? (
            <Button variant="filled" onClick={() => run("engines.hooks.install")}>
              {ts("engines.integrations.install", { count: needInstall })}
            </Button>
          ) : (
            <span className={ENG_UPTODATE}>{ts("engines.integrations.upToDate")}</span>
          )}
          {onDisk > 0 ? (
            <Button variant="action" onClick={() => run("engines.hooks.uninstall")}>
              {ts("engines.integrations.remove", { count: onDisk })}
            </Button>
          ) : null}
        </div>
      </Row>
    </Group>
  )
}

function SkillSection(props: { engines: readonly EngineSetting[]; client: BridgeClient; reload: () => unknown }) {
  const skillable = props.engines.filter((e) => e.skill !== "unsupported")
  const current = skillable.filter((e) => e.skill === "installed").length
  const needInstall = skillable.length - current
  // Shared with the banner, so installing here clears it too.
  const install = () => void installSkill(props.client).then(props.reload)
  return (
    <Group title={ts("engines.skill.title")} hint={ts("engines.skill.hint")}>
      <Row
        label={
          skillable.length > 0
            ? ts("engines.integrations.summary", { installed: current, total: skillable.length })
            : ts("engines.skill.noEngines")
        }
      >
        {needInstall > 0 ? (
          <Button variant="filled" onClick={install}>
            {ts("engines.skill.install", { count: needInstall })}
          </Button>
        ) : skillable.length > 0 ? (
          <span className={ENG_UPTODATE}>{ts("engines.integrations.upToDate")}</span>
        ) : null}
      </Row>
    </Group>
  )
}
