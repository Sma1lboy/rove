/**
 * The Update page (TUI `update-page.tsx`) and What's New (`whats-new-dialog.tsx`), over the
 * bridge's read-only `update.check` / `release.notes`. Copy is the TUI's `update.*` catalog.
 * No "Update now": running the updater from a browser replaces the Mac's install, which the
 * bridge does not offer; the page names the command to run instead.
 */

import { en as upEn, zh as upZh } from "@sma1lboy/rove/src/tui/i18n/messages/update.ts"
import type { ReleaseNotesRangeItem, UpdateInfo } from "@sma1lboy/rove/src/version.ts"
import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { DialogShell } from "./dialogs.tsx"
import { locale, t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import { openPage } from "./layout.ts"
import { ReleaseNotes } from "./release-notes.tsx"
import { createStore, useStore } from "./store.ts"
import { dialog, page } from "./ui.ts"
import { HEAD_CHIP } from "./ui/shell.ts"
import {
  PAGE_HEAD,
  RELEASE_NOTES,
  UPDATE_ACTIONS,
  UPDATE_CHIP,
  UPDATE_CHIP_VERSION,
  UPDATE_LABEL,
  UPDATE_VERSIONS,
  WHATS_NEW_BODY,
  WHATS_NEW_KEYS,
  updateActionClass,
} from "./ui/update.ts"

interface CheckReply {
  readonly current: string
  readonly info: UpdateInfo | null
  readonly notes: readonly ReleaseNotesRangeItem[]
}

/** The last answer, shared by the rail chip and the page. `null` = not asked yet. */
export const updateState = createStore<CheckReply | null>(null)

const fill = (text: string, p: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => p[k] ?? m)
const releaseUrl = (version: string) => `https://github.com/Sma1lboy/rove/releases/tag/v${version}`

export function useCatalog() {
  return useLocale() === "zh" ? upZh : upEn
}

export function checkForUpdate(client: BridgeClient): Promise<void> {
  return client
    .request<CheckReply>("update.check", { force: true, locale: locale.get() })
    .then(updateState.set, () => {})
}

/** Rail head chip, as the TUI brand row's `↑ v`: only when the registry says newer. */
export function UpdateChip() {
  const u = useCatalog()
  const state = useStore(updateState)
  if (!state?.info?.hasUpdate) return null
  return (
    // A narrow rail keeps only the arrow (the version is in the title); a wide one shows both.
    <button
      type="button"
      className={`kicker ${UPDATE_CHIP} ${HEAD_CHIP}`}
      title={fill(u.chip, { version: state.info.latest })}
      onClick={() => openPage("update")}
    >
      ↑<span className={UPDATE_CHIP_VERSION}> {state.info.latest}</span>
    </button>
  )
}

type ActionId = "release" | "close"

export function UpdateView({ client }: { client: BridgeClient }) {
  const u = useCatalog()
  const state = useStore(updateState)
  const [checked, setChecked] = useState(false)
  const [selected, setSelected] = useState<ActionId>("release")
  const [status, setStatus] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
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
  const actions: readonly { id: ActionId; key: string; label: string; detail: string }[] = [
    { id: "release", key: "R", label: u.actions.openRelease, detail: url ?? u.releaseUrlUnavailable },
    { id: "close", key: "Q", label: u.actions.close, detail: u.actions.closeDetail },
  ]
  const activate = (id: ActionId) => {
    if (id === "close") return page.set(null)
    setStatus(url && window.open(url, "_blank", "noopener") !== null ? u.statusReleaseOpened : u.statusReleaseError)
  }
  const onKey = (e: React.KeyboardEvent) => {
    // Ctrl+C closes, as the TUI's page bindings; a text selection keeps the browser's copy.
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault()
      return activate("close")
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const i = actions.findIndex((a) => a.id === selected)
    if (e.key === "j" || e.key === "ArrowDown") setSelected(actions[(i + 1) % actions.length]?.id ?? "close")
    else if (e.key === "k" || e.key === "ArrowUp")
      setSelected(actions[(i - 1 + actions.length) % actions.length]?.id ?? "close")
    else if (e.key === "Enter") activate(selected)
    else if (e.key === "r") activate("release")
    else if (e.key === "q" || e.key === "Escape") activate("close")
    else return
    e.preventDefault()
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className="page" tabIndex={0} ref={host} onKeyDown={onKey}>
      <div className={PAGE_HEAD}>
        <h1 className="page-title mono">{u.pageTitle}</h1>
        <button type="button" className="link muted mono" onClick={() => activate("close")}>
          {isTouch() ? t("dialog.close") : u.closeHint}
        </button>
      </div>
      <p className={`mono ${UPDATE_VERSIONS}`}>
        <span className="muted">{u.current}</span> <b>v{current}</b> <span className="muted">{u.latest}</span>{" "}
        {latestUnknown ? (
          <b className="muted">{u.latestUnknown}</b>
        ) : checked ? (
          <b className={hasUpdate ? "tone-warning" : "tone-success"}>v{latest}</b>
        ) : (
          <span className="muted">…</span>
        )}
      </p>
      {latestUnknown && <p className="muted">{u.registryRetry}</p>}
      {upToDate && <p className="tone-success">{u.upToDate}</p>}
      {hasUpdate && <p className="mono muted">rove update</p>}
      <div className={UPDATE_ACTIONS}>
        {actions.map((a) => (
          <button
            type="button"
            key={a.id}
            className={updateActionClass(selected === a.id)}
            onClick={() => activate(a.id)}
          >
            <span className="tone-accent mono keys-only">[{a.key}]</span>
            <span className={UPDATE_LABEL}>{a.label}</span>
            <span className="muted">{a.detail}</span>
          </button>
        ))}
      </div>
      {status && <p className="mono tone-accent">{status}</p>}
      {hasUpdate && <p className="mono muted">{fill(u.changesSectionHeader, { from: current, to: latest })}</p>}
      {!checked && <p className="muted">{u.loadingNotes}</p>}
      {checked && hasUpdate && notes.length === 0 && <p className="muted">{u.notesUnavailable}</p>}
      {notes.map((n) => (
        <section key={n.version} className={RELEASE_NOTES}>
          <h2 className="mono">v{n.version}</h2>
          <ReleaseNotes body={n.body} />
        </section>
      ))}
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
  // Enter takes the primary button, as any dialog; q / esc still close it.
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "q") dialog.set(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <DialogShell title={u.whatsNew.title} wide>
      <p className="muted">{fill(u.whatsNew.upgraded, { from: props.from, to: props.to })}</p>
      <div className={WHATS_NEW_BODY}>
        {props.notes ? (
          <ReleaseNotes body={props.notes.body} />
        ) : (
          <p className="muted">{u.whatsNew.notesUnavailable}</p>
        )}
      </div>
      <div className="actions">
        <span className={`mono muted ${WHATS_NEW_KEYS} touch:hidden!`}>{t("whatsNew.keys")}</span>
        <a className="link" href={props.notes?.url ?? releaseUrl(props.to)} target="_blank" rel="noopener noreferrer">
          {t("whatsNew.openRelease")}
        </a>
        <button ref={ok} type="button" className="button" onClick={() => dialog.set(null)}>
          {t("whatsNew.continue")}
        </button>
      </div>
    </DialogShell>
  )
}
