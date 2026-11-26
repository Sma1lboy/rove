/**
 * Settings → Connectors. GitHub is an account Rove uses: this machine's own `gh` login, with the
 * machines below it showing whether theirs matches; Rove stores no token. Chat connectors are apps
 * Rove can be messaged from, each connected from its own CLI.
 */

import { useState } from "react"
import {
  type GithubStatus,
  LOCAL,
  type LoginState,
  type Mark,
  type Probe,
  loginBusy,
  markOf,
  useGithubConnector,
} from "./connectors-github.ts"
import { t } from "./i18n/index.ts"
import type { MachineRow } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { ChatConnectors } from "./settings-chat-connectors.tsx"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  BENTO,
  BENTO_HEAD,
  BENTO_TITLE,
  CONFIRM_INLINE,
  SETTINGS_ACTIONS,
  SETTINGS_GROUP_HINT,
  SETTINGS_GROUP_LABEL,
  SETTINGS_NAME,
  SETTINGS_NOTE,
  SETTINGS_PANEL,
  SETTINGS_VALUE,
  bentoCardClass,
  lineDetailClass,
} from "./ui/settings.ts"

const MARK_KEY: Readonly<Record<Exclude<Mark, "loading">, string>> = {
  same: "markSame",
  different: "markDifferent",
  signedOut: "markSignedOut",
  noGh: "markNoGh",
  outdated: "markOutdated",
  offline: "markOffline",
  denied: "markDenied",
  failed: "markFailed",
}

const c = (key: string, params?: Record<string, string | number>): string => t(`settings.connectors.${key}`, params)

const MARK_TONE: Readonly<Record<Mark, string>> = {
  same: "text-diff-added",
  signedOut: "text-diff-removed",
  failed: "text-diff-removed",
  denied: "text-diff-removed",
  different: "text-warning",
  outdated: "text-warning",
  offline: "text-muted",
  noGh: "text-muted",
  loading: "text-muted",
}

function markText(mark: Mark, status: GithubStatus | null): string {
  if (mark === "loading") return c("loading")
  return c(MARK_KEY[mark], { login: status?.account ?? "" })
}

function detailOf(status: GithubStatus | null): string {
  if (!status?.gh) return ""
  const ssh = status.ssh.ok ? `✓ ${status.ssh.user ?? ""}`.trim() : "✗"
  return c("detail", { protocol: status.protocol ?? "—", ssh })
}

function GithubMark() {
  return (
    <svg className="size-7 flex-none" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  )
}

function copyCode(code: string): void {
  navigator.clipboard.writeText(code).then(
    () => toast(c("codeCopied")),
    () => {},
  )
}

/** The device flow of one machine: the code to type at GitHub, its link, and a way out. */
function DeviceFlow({ login, onCancel }: { login: LoginState; onCancel: () => void }) {
  if (login.state === "failed") {
    return (
      <div className={SETTINGS_PANEL}>
        <span className="text-muted">{c("loginFailed", { error: login.error ?? "" })}</span>
        <Button className="ml-auto" onClick={onCancel}>
          {c("dismiss")}
        </Button>
      </div>
    )
  }
  if (login.state === "syncing") {
    return (
      <div className={SETTINGS_PANEL}>
        <span className="text-muted">{c("syncing")}</span>
      </div>
    )
  }
  return (
    <div className={SETTINGS_PANEL}>
      {login.code ? (
        <>
          <button
            type="button"
            className="font-mono font-normal normal-nums rounded-sm border-hairline border-dashed border-line px-2 py-0.5 text-display tracking-code"
            title={c("codeHint")}
            onClick={() => copyCode(login.code ?? "")}
          >
            {login.code}
          </button>
          <a href={login.url} target="_blank" rel="noreferrer">
            {c("openGithub")}
          </a>
        </>
      ) : (
        <span className="text-muted">{c("loading")}</span>
      )}
      <Button className="ml-auto" onClick={onCancel}>
        {t("dialog.cancel")}
      </Button>
    </div>
  )
}

interface LineProps {
  readonly name: string
  readonly probe: Probe | undefined
  readonly machine: MachineRow["state"] | null
  readonly rove: string | null
  readonly busy: boolean
  readonly onSync?: () => void
  readonly onLogin?: () => void
  readonly onCancel: () => void
}

function MachineCard(p: LineProps) {
  const mark = markOf(p.probe, p.machine, p.rove)
  const status = p.probe?.status ?? null
  const flowing = loginBusy(status)
  const needsAccount = mark === "different" || mark === "signedOut"
  const login = status?.login
  const detail = detailOf(status)
  const actions = needsAccount && !flowing
  return (
    <div className={bentoCardClass()}>
      <div className={BENTO_HEAD}>
        <span className={`${SETTINGS_NAME} min-w-0 flex-1 truncate`}>{p.name}</span>
        <span className={`whitespace-nowrap text-meta ${MARK_TONE[mark]}`} title={p.probe?.message}>
          {markText(mark, status)}
        </span>
      </div>
      {detail && (
        <span
          className={lineDetailClass()}
          title={[status?.authDetail, status?.ssh.detail].filter(Boolean).join(", ") || undefined}
        >
          {detail}
        </span>
      )}
      {actions && (p.onSync || p.onLogin) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {p.onSync && p.rove && (
            <Button variant="action" disabled={p.busy} onClick={p.onSync}>
              {c("useRove")}
            </Button>
          )}
          {p.onLogin && (
            <Button variant="action" disabled={p.busy} onClick={p.onLogin}>
              {c("loginThere")}
            </Button>
          )}
        </div>
      )}
      {login && <DeviceFlow login={login} onCancel={p.onCancel} />}
    </div>
  )
}

function GithubCard({ model }: { model: AppModel }) {
  const { machines, probes, refreshing, refresh, probe, act } = useGithubConnector(model)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const local = probes[LOCAL]
  const rove = local?.status?.account ?? null
  const flowing = loginBusy(local?.status)

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }
  const login = (key: string) =>
    run(key, async () => {
      await act("github.login", key === LOCAL ? {} : { machine: key })
      await probe(key)
    })
  const cancel = (key: string) =>
    run(key, async () => {
      await act("github.login", key === LOCAL ? { cancel: true } : { machine: key, cancel: true })
      await probe(key)
    })
  const sync = (alias: string) =>
    run(alias, async () => {
      const out = await act("github.sync", { machine: alias })
      if (out?.ok) toast(c("synced", { machine: alias, login: rove ?? "" }))
      await probe(alias)
    })
  const disconnect = () =>
    run(LOCAL, async () => {
      const out = await act("github.logout", {})
      if (out?.ok) setConfirming(false)
      await refresh()
    })

  return (
    <div className={BENTO}>
      <div className={bentoCardClass(true)}>
        <div className={`${BENTO_HEAD} w-narrow:flex-wrap`}>
          {/* On a phone the account and its button drop under the name, so the description keeps its width. */}
          <span className="flex min-w-0 flex-1 items-center gap-3 w-narrow:basis-full">
            <GithubMark />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={SETTINGS_NAME}>GitHub</span>
              <span className={SETTINGS_NOTE}>{c("githubDescription")}</span>
            </span>
          </span>
          {rove ? (
            <>
              <span className={SETTINGS_VALUE}>@{rove}</span>
              <Button variant="action" disabled={busy !== null} onClick={() => setConfirming(true)}>
                {c("disconnect")}
              </Button>
            </>
          ) : !local ? (
            // Not known yet: say so, rather than offer Connect to someone who may be signed in.
            <span className="text-meta text-muted">{c("loading")}</span>
          ) : (
            !flowing && (
              <Button variant="filled" disabled={busy !== null} onClick={() => void login(LOCAL)}>
                {c("connect")}
              </Button>
            )
          )}
        </div>
        {confirming && (
          <div className={CONFIRM_INLINE}>
            <p>{c("disconnectBody")}</p>
            <div className={SETTINGS_ACTIONS}>
              <Button onClick={() => setConfirming(false)}>{t("dialog.cancel")}</Button>
              <Button variant="danger" disabled={busy !== null} onClick={() => void disconnect()}>
                {c("disconnect")}
              </Button>
            </div>
          </div>
        )}
        {!rove && local?.status?.login && <DeviceFlow login={local.status.login} onCancel={() => void cancel(LOCAL)} />}
      </div>
      {/* Listed from the start, each card "checking…", so nothing jumps in when the answers land; gone only once this machine is known to be signed out. */}
      {(rove || !local) && (
        <section className="col-span-2 flex flex-col pt-4 w-narrow:col-span-1">
          <div className={BENTO_TITLE}>
            <h2 className={SETTINGS_GROUP_LABEL}>{c("machines")}</h2>
            {refreshing ? (
              <span className="text-meta text-muted">{c("refreshing")}</span>
            ) : (
              <Button onClick={() => void refresh()}>{c("refresh")}</Button>
            )}
          </div>
          <p className={SETTINGS_GROUP_HINT}>{c("machinesHint")}</p>
          <div className={BENTO}>
            <MachineCard
              name={c("thisMachine")}
              probe={local}
              machine={null}
              rove={rove}
              busy={busy !== null}
              onCancel={() => void cancel(LOCAL)}
            />
            {machines.map((m) => (
              <MachineCard
                key={m.alias}
                name={m.alias}
                probe={probes[m.alias]}
                machine={m.state}
                rove={rove}
                busy={busy !== null}
                onSync={() => void sync(m.alias)}
                onLogin={() => void login(m.alias)}
                onCancel={() => void cancel(m.alias)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function ConnectorsSection({ model }: { model: AppModel }) {
  return (
    <>
      <GithubCard model={model} />
      <ChatConnectors model={model} />
    </>
  )
}
