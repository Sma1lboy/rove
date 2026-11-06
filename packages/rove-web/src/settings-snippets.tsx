/** Settings → Snippets: the saved `@name` prompts, one row each, with a small form to add or edit one. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { Group, Row } from "./settings-rows.tsx"
import { SNIPPET_NAME, loadSnippets, removeSnippet, saveSnippet, useSnippets } from "./snippets.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  SETTINGS_ACTIONS,
  SETTINGS_FIELD,
  SETTINGS_FIELD_LABEL,
  SETTINGS_INPUT,
  SETTINGS_NOTE,
  SETTINGS_TEXTAREA,
} from "./ui/settings.ts"

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? ""

function SnippetForm(props: {
  client: BridgeClient
  /** The name being edited; absent = a new snippet. */
  editing?: { name: string; text: string }
  onDone: () => void
}) {
  const [name, setName] = useState(props.editing?.name ?? "")
  const [text, setText] = useState(props.editing?.text ?? "")
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
          className={`${SETTINGS_INPUT} ${SETTINGS_TEXTAREA} w-full`}
          rows={5}
          value={text}
          maxLength={8000}
          placeholder={t("snippets.textPlaceholder")}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className={SETTINGS_ACTIONS}>
        <Button onClick={props.onDone}>{t("snippets.cancel")}</Button>
        <Button type="submit" disabled={busy || !valid}>
          {t("snippets.save")}
        </Button>
      </div>
    </form>
  )
}

export function SnippetsSection({ model }: { model: AppModel }) {
  const { client } = model
  const snippets = useSnippets()
  // `null` = no form; "new" = a new snippet; otherwise the snippet being edited.
  const [form, setForm] = useState<{ name: string; text: string } | "new" | null>(null)
  useEffect(() => void loadSnippets(client).catch(() => undefined), [client])
  return (
    <div className="flex flex-col gap-4">
      <p className={`m-0 ${SETTINGS_NOTE}`}>{t("snippets.hint")}</p>
      <Group>
        {snippets.length === 0 && form === null && <Row label={t("snippets.empty")} />}
        {snippets.map((s) => (
          <Row key={s.name} label={<span className="font-mono">@{s.name}</span>} hint={firstLine(s.text)}>
            <Button onClick={() => setForm(s)}>{t("snippets.edit")}</Button>
            <Button
              onClick={() =>
                void removeSnippet(client, s.name)
                  .then(() => {
                    setForm(null)
                    toast(t("snippets.removed", { name: s.name }))
                  })
                  .catch((err) => toast(errorText(err), "error"))
              }
            >
              {t("snippets.remove")}
            </Button>
          </Row>
        ))}
      </Group>
      {form === null ? (
        <div className={SETTINGS_ACTIONS}>
          <Button onClick={() => setForm("new")}>{t("snippets.add")}</Button>
        </div>
      ) : (
        <SnippetForm
          key={form === "new" ? "new" : form.name}
          client={client}
          editing={form === "new" ? undefined : form}
          onDone={() => setForm(null)}
        />
      )}
    </div>
  )
}
