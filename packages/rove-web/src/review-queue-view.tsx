/**
 * The Issues page's "PRs waiting on me": open PRs that ask for your review in the projects Rove knows, read-only
 * through `gh`. j/k or arrows move, Enter (or `[ review ]`) opens New session on the PR's head with a review prompt,
 * `r` rereads past the 60 s cache, q/Esc close. Nothing here writes to GitHub.
 */

import { relativeAge } from "@sma1lboy/rove/src/lib/relative-time.ts"
import { useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage, usePageFocus, usePageKeys } from "./pages-kit.ts"
import { type ReviewPr, type ReviewQueueReply, reviewSeed } from "./review-queue.ts"
import { SourceSwitch } from "./source-switch.tsx"
import { openNewSessionFrom, page, toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  PAGE_SCROLL,
  PAGE_TITLE,
  PG_GROW,
  PG_ISSUE_LINE,
  PG_ISSUE_NUM,
  PG_ISSUE_SUB,
  PG_LIST,
  PG_NOTICE,
  PG_TOP,
  pgIssueClass,
} from "./ui/page.ts"

const CHECKS = {
  passing: "review.checksPassing",
  failing: "review.checksFailing",
  pending: "review.checksPending",
} as const
const GH_REASON = {
  missing: "review.gh.missing",
  unauthenticated: "review.gh.unauthenticated",
  failed: "review.gh.failed",
} as const

function Row(props: {
  pr: ReviewPr
  at: boolean
  now: number
  busy: boolean
  index: number
  onPick: () => void
  onReview: () => void
}) {
  const { pr } = props
  const created = Date.parse(pr.createdAt)
  const tags = [
    pr.isDraft ? t("review.draft") : "",
    pr.fork ? t("review.fork") : "",
    pr.checks ? t(CHECKS[pr.checks]) : "",
  ]
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
    <div data-row={props.index} className={pgIssueClass(props.at)} onClick={props.onPick}>
      <div className={PG_ISSUE_LINE}>
        <span className={`mono ${PG_ISSUE_NUM}`}>
          {pr.nameWithOwner.split("/")[1]}#{pr.number}
        </span>
        <span className={PG_GROW}>{pr.title}</span>
        <Button disabled={props.busy} onClick={props.onReview}>
          {t("review.start")}
        </Button>
      </div>
      <div className={PG_ISSUE_SUB}>
        <span className={PG_GROW}>{[pr.author, ...tags].filter(Boolean).join(", ")}</span>
        <span className="mono">
          +{pr.additions} −{pr.deletions}
        </span>
        <span className="mono">{Number.isFinite(created) ? relativeAge(created, props.now) : ""}</span>
      </div>
    </div>
  )
}

export function ReviewQueueView({ model }: { model: AppModel }) {
  useLocale()
  const c = model.client
  const [reply, setReply] = useState<ReviewQueueReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useRef(false)
  const root = usePageFocus()
  const list = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    const forced = refresh.current
    refresh.current = false
    setError(null)
    c.request<ReviewQueueReply>("review.queue", forced ? { refresh: true } : {})
      .then((res) => live && setReply(res))
      .catch((err: unknown) => {
        if (!live) return
        setError(errorMessage(err))
        setReply({ prs: [], other: 0 })
      })
    return () => {
      live = false
    }
  }, [c, tick])

  const rows = reply?.prs ?? []
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at])

  const review = async (pr: ReviewPr) => {
    if (busy !== null) return
    setBusy(pr.number)
    setNotice(t("review.preparing", { number: pr.number }))
    try {
      const { ref } = await c.request<{ ref: string }>("review.prepare", { repo: pr.repo, number: pr.number })
      openNewSessionFrom(
        reviewSeed(
          pr,
          ref,
          t("review.prompt", {
            number: pr.number,
            repo: pr.nameWithOwner,
            title: pr.title,
            url: pr.url,
            head: pr.headRef,
            base: pr.baseRef,
          }),
        ),
      )
    } catch (err) {
      toast(t("review.failed", { number: pr.number, error: errorMessage(err) }), "error")
    } finally {
      setBusy(null)
      setNotice(null)
    }
  }

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
    switch (e.key) {
      case "Escape":
      case "q":
        page.set(null)
        return true
      case "j":
      case "ArrowDown":
        setCursor(Math.min(rows.length - 1, at + 1))
        return true
      case "k":
      case "ArrowUp":
        setCursor(Math.max(0, at - 1))
        return true
      case "r":
        refresh.current = true
        setTick((n) => n + 1)
        return true
      case "Enter": {
        const pr = rows[at]
        if (pr) void review(pr)
        return true
      }
      default:
        return false
    }
  })

  const now = Date.now()
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={PAGE_SCROLL} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{t("review.title")}</h1>
        <SourceSwitch />
      </div>
      {error ? (
        <p className="text-error">{error}</p>
      ) : reply === null ? (
        <p className="text-muted">…</p>
      ) : reply.reason ? (
        <p className="text-muted">{t(GH_REASON[reply.reason])}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t("review.empty")}</p>
      ) : (
        <div className={PG_LIST} ref={list}>
          {rows.map((pr, index) => (
            <Row
              key={`${pr.nameWithOwner}#${pr.number}`}
              pr={pr}
              index={index}
              at={index === at}
              now={now}
              busy={busy !== null}
              onPick={() => setCursor(index)}
              onReview={() => void review(pr)}
            />
          ))}
        </div>
      )}
      {reply && reply.other > 0 && (
        <p className={`text-muted ${PG_NOTICE}`}>{t("review.other", { count: reply.other })}</p>
      )}
      {notice && <p className={`text-muted ${PG_NOTICE}`}>{notice}</p>}
    </div>
  )
}
