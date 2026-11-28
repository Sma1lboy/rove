/**
 * The Update page (TUI `update-page.tsx`) and What's New (`whats-new-dialog.tsx`), over the
 * bridge's `update.check` / `release.notes`, and Update now over `update.run` / `update.status`:
 * the installer runs on the computer serving the page, which polls it, then Restart (`update.restart`)
 * puts the daemon and the bridge on what it installed. Copy is the TUI's `update.*` catalog.
 */

import { en as upEn, zh as upZh } from "@sma1lboy/rove-core/i18n/messages/update.ts"
import type { ReleaseChannel } from "@sma1lboy/rove-core/release-channels.ts"
import type { ReleaseNotesRangeItem, UpdateInfo } from "@sma1lboy/rove-core/version.ts"
import { useEffect, useRef, useState } from "react"
import { type BridgeClient, BridgeRequestError } from "./bridge.ts"
import { DialogShell } from "./dialogs.tsx"
import { locale, t, useLocale } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { useNarrow } from "./layout.ts"
import { usePrefs } from "./prefs.ts"
import { ReleaseNotes } from "./release-notes.tsx"
import { createStore, useStore } from "./store.ts"
import { closeDialog, dialog, page } from "./ui.ts"
import { Button, buttonClass } from "./ui/button.tsx"
import { PAGE_TITLE } from "./ui/page.ts"
import { PhoneActions, PhonePage } from "./ui/phone.tsx"
import { Sheet } from "./ui/sheet.tsx"
import { HEAD_CHIP } from "./ui/shell.ts"
import { ACTIONS } from "./ui/text.ts"
import {
  RELEASE_NOTES,
  UPDATE_OUTPUT,
  UPDATE_PAGE,
  UPDATE_SCROLL,
  UPDATE_VERSIONS,
  WHATS_NEW_BODY,
  WHATS_NEW_KEYS,
  WHATS_NEW_SHEET_BODY,
  WHATS_NEW_SHEET_FOOT,
} from "./ui/update.ts"

interface CheckReply {
  readonly current: string
  readonly info: UpdateInfo | null
  readonly notes: readonly ReleaseNotesRangeItem[]
}

/** The last answer, shared by the rail chip and the page. `null` = not asked yet. */
export const updateState = createStore<CheckReply | null>(null)

/** Set by the update prompt's Update: the page starts the install as it opens, with nothing more to click. */
export const updateAutoRun = createStore(false)

const fill = (text: string, p: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => p[k] ?? m)
const releaseUrl = (version: string) => `https://github.com/Sma1lboy/rove/releases/tag/v${version}`

export function useCatalog() {
  return useLocale() === "zh" ? upZh : upEn
}

/**
 * Asks the registry (bypassing the bridge cache). `channel` names the dist-tag; without it the bridge
 * follows the stored `update.channel`. `false` = the request itself failed.
 */
export function checkForUpdate(client: BridgeClient, channel?: ReleaseChannel): Promise<boolean> {
  return client.request<CheckReply>("update.check", { force: true, locale: locale.get(), channel }).then(
    (reply) => {
      updateState.set(reply)
      return true
    },
    () => false,
  )
}

export function UpdateChip() {
  const u = useCatalog()
  const state = useStore(updateState)
  const { prefs } = usePrefs()
  if (!prefs.updateNotify || !state?.info?.hasUpdate) return null
  const hint = fill(u.available, { version: state.info.latest })
  return (
    <Button
      variant="row"
      className={`${HEAD_CHIP} whitespace-nowrap font-mono text-meta text-warning`}
      aria-label={`${t("rail.update")} · ${hint}`}
      title={hint}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation()
      }}
      onClick={() => openPage("update")}
    >
      ↑<span className="rail-tight:hidden"> {state.info.latest}</span>
    </Button>
  )
}

type ActionId = "update" | "restart" | "release" | "close"

/** Each release in the range under its version, newest first as the bridge sends them. */
export function NotesRange({ notes }: { notes: readonly ReleaseNotesRangeItem[] }) {
  return notes.map((n) => (
    <section key={n.version} className={RELEASE_NOTES}>
      <h2 className="mono">v{n.version}</h2>
      <ReleaseNotes body={n.body} />
    </section>
  ))
}

/** The bridge's last `update.run`; `null` = none since it started. */
interface RunStatus {
  readonly running: boolean
  readonly command: string
  readonly code: number | null
  readonly output: string
}

const POLL_MS = 1000

/** Reads `update.status` once now, then every second while the installer runs. */
function useUpdateRun(client: BridgeClient) {
  const [run, setRun] = useState<RunStatus | null>(null)
  const [polling, setPolling] = useState(true)
  useEffect(() => {
    if (!polling) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () =>
      client.request<{ status: RunStatus | null }>("update.status", {}).then(
        (r) => {
          if (!alive) return
          setRun(r.status)
          if (r.status?.running) timer = setTimeout(tick, POLL_MS)
          else setPolling(false)
        },
        () => alive && setPolling(false),
      )
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [client, polling])
  return { run, setRun, poll: () => setPolling(true) }
}

export function UpdateView({ client }: { client: BridgeClient }) {
  const u = useCatalog()
  const state = useStore(updateState)
  const [checked, setChecked] = useState(false)
  const autoRun = useStore(updateAutoRun)
  const [status, setStatus] = useState<string | null>(null)
  const { run, setRun, poll } = useUpdateRun(client)
  const host = useRef<HTMLDivElement>(null)
  const phone = useNarrow()
  useEffect(() => {
    host.current?.focus()
    void checkForUpdate(client).finally(() => setChecked(true))
  }, [client])

  const info = state?.info ?? null
  const current = state?.current ?? ""
  const latest = info?.latest ?? current
  const hasUpdate = info?.hasUpdate === true
  const latestUnknown = checked && info === null
  const upToDate = checked && info !== null && !hasUpdate
  const notes = state?.notes ?? []
  const url = notes[0]?.url ?? (latest ? releaseUrl(latest) : null)
  // Installed but not yet running: the old bridge still reports an update, and installing twice does nothing.
  const installed = run?.code === 0
  const [restarting, setRestarting] = useState(false)
  const canUpdate = hasUpdate && !run?.running && !installed
  const activate = (id: ActionId) => {
    if (id === "close") return page.set(null)
    if (id === "restart") {
      if (!installed || restarting) return
      setRestarting(true)
      // A refusal re-arms the button; a dropped socket is the restart itself, and the reconnect reloads the page.
      return void client
        .request("update.restart", {})
        .catch((err) => err instanceof BridgeRequestError && setRestarting(false))
    }
    if (id === "update") {
      if (!canUpdate) return
      setStatus(null)
      return void client.request<{ status: RunStatus | null }>("update.run", {}).then(
        (r) => {
          setRun(r.status)
          poll()
        },
        (err: unknown) => {
          // BUSY: another page already started it; follow that run.
          if (err instanceof BridgeRequestError && err.code === "BUSY") return poll()
          setStatus(fill(u.webStartFailed, { error: err instanceof Error ? err.message : String(err) }))
        },
      )
    }
    setStatus(url && window.open(url, "_blank", "noopener") !== null ? u.statusReleaseOpened : u.statusReleaseError)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once, when the check has answered
  useEffect(() => {
    if (!checked || !autoRun) return
    updateAutoRun.set(false)
    if (hasUpdate) activate("update")
  }, [checked, hasUpdate, autoRun])
  const onKey = (e: React.KeyboardEvent) => {
    // Ctrl+C closes, as the TUI's page bindings; a text selection keeps the browser's copy.
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault()
      return activate("close")
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Enter on a focused button or link is that control's own.
    if (e.key === "Enter" && e.target === host.current)
      activate(installed ? "restart" : canUpdate ? "update" : "release")
    else if (e.key === "Enter") return
    else if (e.key === "u") activate("update")
    else if (e.key === "r") activate("release")
    else if (e.key === "q" || e.key === "Escape") activate("close")
    else return
    e.preventDefault()
  }

  const [own, setOwn] = useState<ReleaseNotesRangeItem | null>(null)
  useEffect(() => {
    if (!phone || !upToDate || !current) return
    let live = true
    client
      .request<{ notes: ReleaseNotesRangeItem | null }>("release.notes", {
        version: current.replace(/-.*$/, ""),
        locale: locale.get(),
      })
      .then((r) => live && setOwn(r.notes))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [client, phone, upToDate, current])

  const notesBody = (
    <>
      <p className={`mono ${UPDATE_VERSIONS}`}>
        <span className="text-muted">{u.current}</span> <b>v{current}</b> <span className="text-muted">{u.latest}</span>{" "}
        {latestUnknown ? (
          <b className="text-muted">{u.latestUnknown}</b>
        ) : checked ? (
          <b className={hasUpdate ? "text-warning" : "text-success"}>v{latest}</b>
        ) : (
          <span className="text-muted">…</span>
        )}
      </p>
      {latestUnknown && <p className="text-muted">{u.registryRetry}</p>}
      {upToDate && <p className="text-success">{u.upToDate}</p>}
      {status && <p className="mono text-accent">{status}</p>}
      {run && (
        <>
          {run.output && <pre className={UPDATE_OUTPUT}>{run.output}</pre>}
          <p className={`mono ${run.running ? "text-muted" : run.code === 0 ? "text-success" : "text-error"}`}>
            {run.running
              ? fill(u.webRunning, { command: run.command })
              : run.code === 0
                ? restarting
                  ? u.webRestarting
                  : fill(u.webInstalled, { latest })
                : fill(u.updateFailed, { code: String(run.code) })}
          </p>
        </>
      )}
      {hasUpdate && <p className="mono text-muted">{fill(u.changesSectionHeader, { from: current, to: latest })}</p>}
      {!checked && <p className="text-muted">{u.loadingNotes}</p>}
      {checked && hasUpdate && notes.length === 0 && <p className="text-muted">{u.notesUnavailable}</p>}
      <NotesRange notes={notes} />
    </>
  )
  const actions = (
    <div className={`${ACTIONS} pt-2.5`}>
      {url ? (
        <a
          className={buttonClass({ secondary: true })}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-keyshortcuts="r"
        >
          {u.actions.openRelease}
        </a>
      ) : (
        <span className="text-muted">{u.releaseUrlUnavailable}</span>
      )}
      {installed && (
        <Button variant="filled" disabled={restarting} onClick={() => activate("restart")}>
          {u.webRestart}
        </Button>
      )}
      {canUpdate && (
        <Button variant="filled" aria-keyshortcuts="u" onClick={() => activate("update")}>
          {u.actions.updateNow}
        </Button>
      )}
    </div>
  )
  if (phone)
    return (
      <PhonePage
        title={t("rail.update")}
        rootRef={host}
        action={
          installed
            ? { label: u.webRestart, tone: "accent", disabled: restarting, onClick: () => activate("restart") }
            : canUpdate
              ? {
                  label: t("pages.phone.updateTo", { version: latest }),
                  tone: "accent",
                  onClick: () => activate("update"),
                }
              : { label: t("pages.phone.viewNotes"), disabled: !url, onClick: () => activate("release") }
        }
      >
        {notesBody}
        {/* Up to date: what the running version brought, the web's and the iPhone's entries first. */}
        {own && <NotesRange notes={[own]} />}
      </PhonePage>
    )
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={UPDATE_PAGE} tabIndex={0} ref={host} onKeyDown={onKey}>
      <h1 className={PAGE_TITLE}>{t("rail.update")}</h1>
      <div className={UPDATE_SCROLL}>{notesBody}</div>
      {/* Bottom right, primary last, as the update prompt's. */}
      {actions}
    </div>
  )
}

const SEEN_KEY = "rove.whatsNewSeenVersion"
const semver = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number)
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/**
 * Once per upgrade, as `cli/whats-new.ts`, stamped per browser: a first visit only stamps; a
 * bridge on a newer build than the stamp opens the notes for it.
 */
export function maybeShowWhatsNew(client: BridgeClient, version: string): void {
  const seen = localStorage.getItem(SEEN_KEY)
  localStorage.setItem(SEEN_KEY, version)
  if (!seen || !newer(version, seen)) return
  void client
    .request<{ notes: ReleaseNotesRangeItem | null }>("release.notes", {
      version: version.replace(/-.*$/, ""),
      locale: locale.get(),
    })
    .then(
      (r) => dialog.set(<WhatsNewDialog from={seen} to={version} notes={r.notes} />),
      () => dialog.set(<WhatsNewDialog from={seen} to={version} notes={null} />),
    )
}

function WhatsNewDialog(props: { from: string; to: string; notes: ReleaseNotesRangeItem | null }) {
  const u = useCatalog()
  const phone = useNarrow()
  const title = t("whatsNew.title")
  const releaseHref = props.notes?.url ?? releaseUrl(props.to)
  // Enter takes the primary button on desktop; q / esc still close it.
  const ok = useRef<HTMLButtonElement>(null)
  const dismiss = useRef<() => void>(closeDialog)
  useEffect(() => {
    if (!phone) ok.current?.focus()
  }, [phone])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "q") dismiss.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const notesBody = props.notes ? (
    <ReleaseNotes body={props.notes.body} />
  ) : (
    <p className="text-muted">{u.whatsNew.notesUnavailable}</p>
  )
  if (phone)
    return (
      <Sheet label={title} title={title} onClose={closeDialog}>
        {(close) => {
          dismiss.current = close
          return (
            <>
              <div className={WHATS_NEW_SHEET_BODY}>
                <p className="text-muted">{fill(u.whatsNew.upgraded, { from: props.from, to: props.to })}</p>
                {notesBody}
              </div>
              <div className={WHATS_NEW_SHEET_FOOT}>
                <PhoneActions
                  actions={[
                    { label: t("whatsNew.openRelease"), href: releaseHref },
                    { label: t("whatsNew.continue"), tone: "accent", onClick: close },
                  ]}
                />
              </div>
            </>
          )
        }}
      </Sheet>
    )
  dismiss.current = closeDialog
  return (
    <DialogShell title={title} wide>
      <p className="m-0 text-muted">{fill(u.whatsNew.upgraded, { from: props.from, to: props.to })}</p>
      <div className={WHATS_NEW_BODY}>{notesBody}</div>
      <div className={ACTIONS}>
        <span className={`mono text-muted ${WHATS_NEW_KEYS} touch:hidden!`}>{t("whatsNew.keys")}</span>
        <a className={buttonClass({ secondary: true })} href={releaseHref} target="_blank" rel="noopener noreferrer">
          {t("whatsNew.openRelease")}
        </a>
        <Button ref={ok} variant="filled" onClick={closeDialog}>
          {t("whatsNew.continue")}
        </Button>
      </div>
    </DialogShell>
  )
}
