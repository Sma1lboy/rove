/**
 * Settings → Connectors → Chat: the apps Rove can be messaged from. Each card says what the app talks as, opens
 * its agent's session, edits who may message it (and the Lark agent's tone), and connects or disconnects it.
 */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { closeDialog, toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  BENTO,
  BENTO_HEAD,
  CONFIRM_INLINE,
  SETTINGS_ACTIONS,
  SETTINGS_GROUP_HINT,
  SETTINGS_GROUP_LABEL,
  SETTINGS_INPUT,
  SETTINGS_NAME,
  SETTINGS_NOTE,
  SETTINGS_VALUE,
  bentoCardClass,
} from "./ui/settings.ts"

const c = (key: string, params?: Record<string, string | number>): string => t(`settings.connectors.${key}`, params)

interface ChatStatus {
  readonly id: string
  readonly connectable?: boolean
  readonly connected: boolean
  readonly since?: string
  readonly account?: string
  readonly owner?: string
  readonly agentTaskId?: string
  readonly allow?: readonly string[]
  readonly tone?: string
}

/** A chat connector is drawn only when this build has words for it; the command connects it from a terminal. */
const CHAT: Readonly<Record<string, { readonly copy: string; readonly command: string }>> = {
  weixin: { copy: "weixin", command: "rove weixin login" },
  lark: { copy: "lark", command: "rove lark connect" },
}

function ChatMark({ id }: { id: string }) {
  return (
    <svg className="size-7 flex-none" viewBox="0 0 16 16" aria-hidden="true">
      {id === "lark" ? (
        <path
          fill="currentColor"
          d="M14.6 1.6 1.5 7.2c-.5.2-.5.9 0 1.1l3.4 1.3 1.3 3.9c.2.5.8.6 1.1.2l1.9-2.1 3.3 2.4c.4.3 1 .1 1.1-.4l2-11.2c.1-.5-.5-1-1-.8ZM6 9.3l6.2-5.1-4.8 6-.4 2.1L6 9.3Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M6 2C3.2 2 1 3.9 1 6.2c0 1.3.7 2.5 1.8 3.2L2.3 11l1.9-1c.6.2 1.2.3 1.8.3h.3A3.6 3.6 0 0 1 6.2 9c0-2.2 2-3.9 4.5-3.9h.2C10.4 3.3 8.4 2 6 2Zm4.7 3.9c-2.1 0-3.7 1.4-3.7 3.1s1.6 3.1 3.7 3.1c.5 0 .9-.1 1.3-.2l1.5.8-.4-1.3c.8-.6 1.3-1.4 1.3-2.4 0-1.7-1.6-3.1-3.7-3.1Z"
        />
      )}
    </svg>
  )
}

/** One labelled line under a card's head: the label in the name column, the control after it. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pl-10 w-narrow:pl-0">
      <span className="w-28 flex-none whitespace-nowrap text-meta text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function ChatCard({ model, row, reload }: { model: AppModel; row: ChatStatus; reload: () => Promise<void> }) {
  const { client } = model
  const meta = CHAT[row.id] as { copy: string; command: string }
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [next, setNext] = useState<string | null>(null)
  const [adding, setAdding] = useState("")
  const [tone, setTone] = useState(row.tone ?? "")
  useEffect(() => setTone(row.tone ?? ""), [row.tone])

  const run = async (op: string, args: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      return await client.request<Record<string, unknown>>(op, { id: row.id, ...args })
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
      await reload()
    }
  }
  const connect = async () => {
    const out = await run("connectors.chatConnect")
    setNext(out?.ok === false && typeof out.message === "string" ? out.message : null)
  }
  const allow = row.allow ?? []
  const setAllow = (ids: readonly string[]) => void run("connectors.chatUpdate", { allow: ids })
  const add = () => {
    const id = adding.trim()
    if (!id) return
    setAdding("")
    setAllow([...allow, id])
  }
  const saveTone = () => {
    if (tone.trim() !== (row.tone ?? "")) void run("connectors.chatUpdate", { tone })
  }
  const openAgent = (taskId: string) => {
    closeDialog()
    model.select(taskId)
  }

  return (
    <div className={bentoCardClass(true)}>
      <div className={`${BENTO_HEAD} w-narrow:flex-wrap`}>
        <span className="flex min-w-0 flex-1 items-center gap-3 w-narrow:basis-full">
          <ChatMark id={row.id} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={SETTINGS_NAME}>{c(`${meta.copy}Name`)}</span>
            <span className={SETTINGS_NOTE}>{c(`${meta.copy}Description`)}</span>
          </span>
        </span>
        {row.connected ? (
          <>
            {row.account && (
              <span
                className={SETTINGS_VALUE}
                title={row.since ? c("chatSince", { date: row.since.slice(0, 10) }) : undefined}
              >
                {row.account}
              </span>
            )}
            {row.agentTaskId && (
              <Button variant="action" onClick={() => openAgent(row.agentTaskId as string)}>
                {c("chatOpen")}
              </Button>
            )}
            <Button variant="action" disabled={busy} onClick={() => setConfirming(true)}>
              {c("disconnect")}
            </Button>
          </>
        ) : row.connectable ? (
          <Button variant="filled" disabled={busy} onClick={() => void connect()}>
            {busy ? c("chatConnecting") : c("connect")}
          </Button>
        ) : (
          <span className={SETTINGS_VALUE}>{c("chatNotConnected")}</span>
        )}
      </div>
      {!row.connected && (next ?? !row.connectable) && (
        <p className={`${SETTINGS_NOTE} m-0 pl-10 w-narrow:pl-0`}>
          {c("chatRunInTerminal", { command: next ?? meta.command })}
        </p>
      )}
      {row.connected && (
        <>
          <Field label={c("chatAllowed")}>
            <span className="text-meta text-ink">
              {row.owner ? c("chatYouNamed", { name: row.owner }) : c("chatYou")}
            </span>
            {allow.map((id) => (
              <span key={id} className="inline-flex min-w-0 items-center gap-1 font-mono text-meta text-muted">
                <span className="max-w-40 truncate" title={id}>
                  {id}
                </span>
                <Button
                  hit="tight"
                  disabled={busy}
                  aria-label={c("chatRemove", { id })}
                  title={c("chatRemove", { id })}
                  onClick={() => setAllow(allow.filter((a) => a !== id))}
                >
                  ×
                </Button>
              </span>
            ))}
            <input
              className={`${SETTINGS_INPUT} w-44 py-0.5 text-meta`}
              placeholder={c("chatAllowAdd")}
              value={adding}
              spellCheck={false}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) add()
              }}
              onBlur={add}
            />
          </Field>
          {row.tone !== undefined && (
            <Field label={c("chatTone")}>
              <input
                className={`${SETTINGS_INPUT} min-w-0 flex-1 py-0.5 text-meta`}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur()
                }}
                onBlur={saveTone}
              />
            </Field>
          )}
        </>
      )}
      {confirming && (
        <div className={CONFIRM_INLINE}>
          <p>{c("chatDisconnectBody", { name: c(`${meta.copy}Name`), command: meta.command })}</p>
          <div className={SETTINGS_ACTIONS}>
            <Button onClick={() => setConfirming(false)}>{t("dialog.cancel")}</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void run("connectors.chatDisconnect").then(() => setConfirming(false))}
            >
              {c("disconnect")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ChatConnectors({ model }: { model: AppModel }) {
  const { client } = model
  const [rows, setRows] = useState(() => lastReply<{ connectors: ChatStatus[] }>(client, "connectors.chat")?.connectors)
  const reload = () =>
    requestRemembered<{ connectors: ChatStatus[] }>(client, "connectors.chat").then(
      (reply) => setRows(reply.connectors),
      // A bridge without the op has no chat connectors to list.
      () => setRows((now) => now ?? []),
    )
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per client
  useEffect(() => {
    void reload()
  }, [client])
  const known = (rows ?? []).filter((row) => CHAT[row.id])
  if (known.length === 0) return null
  return (
    <section className="flex flex-col pt-4">
      <h2 className={SETTINGS_GROUP_LABEL}>{c("chat")}</h2>
      <p className={SETTINGS_GROUP_HINT}>{c("chatHint")}</p>
      <div className={BENTO}>
        {known.map((row) => (
          <ChatCard key={row.id} model={model} row={row} reload={reload} />
        ))}
      </div>
    </section>
  )
}
