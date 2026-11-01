/**
 * Settings → Connectors. One card per service, GitHub for now: Rove's account is this machine's own
 * `gh` login, and the machines below it show whether theirs matches. Rove stores no token.
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
import { Group } from "./settings-rows.tsx"
import { toast } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import { CONFIRM_INLINE, ENGINE_MAIN, ENGINE_ROW, SETTINGS_ROWS, engineDetailClass } from "./ui/settings.ts"

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
    <svg className="flex-none" viewBox="0 0 16 16" width="22" height="22" aria-hidden="true">
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
      <div className="flex items-center gap-2.5 rounded-sm bg-inset px-2 py-1.5 text-meta">
        <span className="muted">{c("loginFailed", { error: login.error ?? "" })}</span>
        <button type="button" className="link" onClick={onCancel}>
          {c("dismiss")}
        </button>
      </div>
    )
  }
  if (login.state === "syncing") {
    return (
      <div className="flex items-center gap-2.5 rounded-sm bg-inset px-2 py-1.5 text-meta">
        <span className="muted">{c("syncing")}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5 rounded-sm bg-inset px-2 py-1.5 text-meta">
      {login.code ? (
        <>
          <button
            type="button"
            className="mono rounded-sm border-hairline border-dashed border-line px-2 py-0.5 text-display tracking-code"
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
        <span className="muted">{c("loading")}</span>
      )}
      <button type="button" className="link" onClick={onCancel}>
        {t("dialog.cancel")}
      </button>
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

function MachineLine(p: LineProps) {
  const mark = markOf(p.probe, p.machine, p.rove)
  const status = p.probe?.status ?? null
  const flowing = loginBusy(status)
  const needsAccount = mark === "different" || mark === "signedOut"
  const login = status?.login
  return (
    <>
      <div className={ENGINE_ROW}>
        <div className={ENGINE_MAIN}>
          <span className="engine-name">{p.name}</span>
          <span
            className={`muted ${engineDetailClass()}`}
            title={[status?.authDetail, status?.ssh.detail].filter(Boolean).join(", ") || undefined}
          >
            {detailOf(status)}
          </span>
        </div>
        <span className={`whitespace-nowrap text-meta ${MARK_TONE[mark]}`} title={p.probe?.message}>
          {markText(mark, status)}
        </span>
        {p.onSync && needsAccount && p.rove && !flowing && (
          <button type="button" disabled={p.busy} onClick={p.onSync}>
            {c("useRove")}
          </button>
        )}
        {p.onLogin && needsAccount && !flowing && (
          <button type="button" disabled={p.busy} onClick={p.onLogin}>
            {c("loginThere")}
          </button>
        )}
      </div>
      {login && <DeviceFlow login={login} onCancel={p.onCancel} />}
    </>
  )
}

function GithubCard({ model }: { model: AppModel }) {
  const { machines, probes, refresh, probe, act } = useGithubConnector(model)
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
    <div className="flex flex-col gap-2 rounded-sm border-hairline border-line p-2.5">
      <div className="flex items-center gap-2.5">
        <GithubMark />
        <div className={ENGINE_MAIN}>
          <span className="engine-name">GitHub</span>
          <span className={`muted ${engineDetailClass(true)}`}>{c("githubDescription")}</span>
        </div>
        {rove ? (
          <>
            <span className="mono">@{rove}</span>
            <button type="button" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {c("disconnect")}
            </button>
          </>
        ) : (
          !flowing && (
            <button
              type="button"
              className={buttonClass()}
              disabled={busy !== null || !local}
              onClick={() => void login(LOCAL)}
            >
              {c("connect")}
            </button>
          )
        )}
      </div>
      {confirming && (
        <div className={CONFIRM_INLINE}>
          <p className="muted">{c("disconnectBody")}</p>
          <div className="actions">
            <button type="button" className="link" onClick={() => setConfirming(false)}>
              {t("dialog.cancel")}
            </button>
            <button
              type="button"
              className={buttonClass({ danger: true })}
              disabled={busy !== null}
              onClick={() => void disconnect()}
            >
              {c("disconnect")}
            </button>
          </div>
        </div>
      )}
      {!rove && local?.status?.login && <DeviceFlow login={local.status.login} onCancel={() => void cancel(LOCAL)} />}
      {rove && (
        <Group title={c("machines")}>
          <div className={SETTINGS_ROWS}>
            <MachineLine
              name={c("thisMachine")}
              probe={local}
              machine={null}
              rove={rove}
              busy={busy !== null}
              onCancel={() => void cancel(LOCAL)}
            />
            {machines.map((m) => (
              <MachineLine
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
          <button type="button" className="link" onClick={() => void refresh()}>
            {c("refresh")}
          </button>
        </Group>
      )}
    </div>
  )
}

export function ConnectorsSection({ model }: { model: AppModel }) {
  return <GithubCard model={model} />
}
