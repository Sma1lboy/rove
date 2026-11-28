/** Settings → Snippets: the saved `@name` prompts, one row each, with a small form to add or edit one. */

import { useCallback, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { useNarrow } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { Group, Row, SectionPending } from "./settings-rows.tsx"
import { SNIPPET_NAME, loadSnippets, removeSnippet, saveSnippet, useSnippets } from "./snippets.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import { useGrow } from "./ui/grow.ts"
import {
  SETTINGS_ACTIONS,
  SETTINGS_ADD_ROW,
  SETTINGS_FIELD,
  SETTINGS_FIELD_LABEL,
  SETTINGS_INPUT,
  SETTINGS_NAME,
  SETTINGS_NAV_CHEVRON,
  SETTINGS_NOTE,
  SETTINGS_OPEN_ROW,
  SETTINGS_TEXTAREA,
  SETTINGS_TEXT_STACK,
} from "./ui/settings.ts"

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? ""

function SnippetForm(props: {
  client: BridgeClient
  /** The name being edited; absent = a new snippet. */
  editing?: { name: string; text: string }
  onDone: () => void
  /** A phone's form also deletes the snippet it edits: its row has no room for a second action. */
  onRemove?: () => void
}) {
  const narrow = useNarrow()
  const [name, setName] = useState(props.editing?.name ?? "")
  const [text, setText] = useState(props.editing?.text ?? "")
  const grow = useGrow(text)
  const [busy, setBusy] = useState(false)
  const valid = SNIPPET_NAME.test(name) && text.trim() !== ""
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        void saveSnippet(props.client, { name, text })
          .then(props.onDone)
          .catch((err) => {
            toast(errorText(err), "error")
            setBusy(false)
          })
      }}
    >
      <label className={SETTINGS_FIELD}>
        <span className={SETTINGS_FIELD_LABEL}>{t("snippets.name")}</span>
        <input
          className={`${SETTINGS_INPUT} w-full font-mono`}
          value={name}
          maxLength={32}
          spellCheck={false}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the form opens on a click and starts with its name
          autoFocus={!props.editing}
          readOnly={props.editing !== undefined}
          placeholder={t("snippets.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
        {name !== "" && !SNIPPET_NAME.test(name) && <span className={SETTINGS_NOTE}>{t("snippets.badName")}</span>}
      </label>
      <label className={SETTINGS_FIELD}>
        <span className={SETTINGS_FIELD_LABEL}>{t("snippets.text")}</span>
        <textarea
          ref={grow}
          className={`${SETTINGS_INPUT} ${SETTINGS_TEXTAREA} w-full`}
          rows={5}
          value={text}
          maxLength={8000}
          placeholder={t("snippets.textPlaceholder")}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {narrow ? (
        <div className={SETTINGS_ACTIONS}>
          {props.onRemove && (
            <Button variant="actionDanger" className="mr-auto" onClick={props.onRemove}>
              {t("snippets.phone.remove")}
            </Button>
          )}
          <Button variant="action" onClick={props.onDone}>
            {t("snippets.phone.cancel")}
          </Button>
          <Button variant="filled" type="submit" disabled={busy || !valid}>
            {t("snippets.phone.save")}
          </Button>
        </div>
      ) : (
        <div className={SETTINGS_ACTIONS}>
          <Button onClick={props.onDone}>{t("snippets.cancel")}</Button>
          <Button type="submit" disabled={busy || !valid}>
            {t("snippets.save")}
          </Button>
        </div>
      )}
    </form>
  )
}

export function SnippetsSection({ model }: { model: AppModel }) {
  const { client } = model
  const snippets = useSnippets()
  // `null` = no form; "new" = a new snippet; otherwise the snippet being edited.
  const [form, setForm] = useState<{ name: string; text: string } | "new" | null>(null)
  // Not "no snippets" until a read says so: one that failed shows why.
  const [read, setRead] = useState<{ done: boolean; failed: string | null }>({ done: false, failed: null })
  const reload = useCallback(
    () =>
      loadSnippets(client).then(
        () => setRead({ done: true, failed: null }),
        (err) => setRead((r) => ({ ...r, failed: errorText(err) })),
      ),
    [client],
  )
  useEffect(() => client.onOpen(() => void reload()), [client, reload])
  const narrow = useNarrow()
  const remove = (name: string) =>
    void removeSnippet(client, name)
      .then(() => {
        setForm(null)
        toast(t("snippets.removed", { name }))
      })
      .catch((err) => toast(errorText(err), "error"))
  return (
    <div className="flex flex-col gap-4">
      <Group>
        {snippets.length === 0 &&
          form === null &&
          (read.done ? <Row label={t("snippets.empty")} /> : <SectionPending failed={read.failed} onRetry={reload} />)}
        {snippets.map((s) =>
          narrow ? (
            <Button key={s.name} variant="row" className={SETTINGS_OPEN_ROW} onClick={() => setForm(s)}>
              <span className={SETTINGS_TEXT_STACK}>
                <span className={`${SETTINGS_NAME} font-mono`}>@{s.name}</span>
                <span className={`${SETTINGS_NOTE} truncate`}>{firstLine(s.text)}</span>
              </span>
              <Chevron right className={SETTINGS_NAV_CHEVRON} />
            </Button>
          ) : (
            <Row key={s.name} label={<span className="font-mono">@{s.name}</span>} hint={firstLine(s.text)}>
              <Button onClick={() => setForm(s)}>{t("snippets.edit")}</Button>
              <Button onClick={() => remove(s.name)}>{t("snippets.remove")}</Button>
            </Row>
          ),
        )}
        {narrow && form === null && (
          <Button variant="row" className={SETTINGS_ADD_ROW} onClick={() => setForm("new")}>
            {t("snippets.phone.add")}
          </Button>
        )}
      </Group>
      {narrow && form === null ? null : form === null ? (
        <div className={SETTINGS_ACTIONS}>
          <Button onClick={() => setForm("new")}>{t("snippets.add")}</Button>
        </div>
      ) : (
        <SnippetForm
          key={form === "new" ? "new" : form.name}
          client={client}
          editing={form === "new" ? undefined : form}
          onDone={() => setForm(null)}
          onRemove={narrow && form !== "new" ? () => remove(form.name) : undefined}
        />
      )}
    </div>
  )
}
