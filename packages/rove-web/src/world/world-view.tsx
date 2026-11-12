/**
 * The World page: the GPU-drawn map of the daemon's tasks, with the ordinary DOM panel around it.
 * The canvas owns every moving thing; the HUD is text, so it stays sharp and cheap. A station is
 * a task, its agents are that task's open sessions, and the stream on the right is the tool calls
 * the page has watched land. Picking a station opens its session — the classic terminal, same task.
 */

import { useEffect, useRef, useState } from "react"
import { t } from "../i18n/index.ts"
import type { AppModel } from "../model.ts"
import { useStore } from "../store.ts"
import { page } from "../ui.ts"
import { Button } from "../ui/button.tsx"
import { type Beat, hotFiles, toolTally } from "./beats.ts"
import { WorldScene } from "./scene.ts"
import { shortToolName, toolKind } from "./tool-kinds.ts"
import { WorldFeed, worldStations } from "./world-data.ts"

const KIND_TONE: Readonly<Record<string, string>> = {
  scan: "text-info",
  build: "text-warning",
  run: "text-success",
  plan: "text-merged",
  other: "text-muted",
}

export function WorldView({ model }: { model: AppModel }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<WorldScene | null>(null)
  const feedRef = useRef<WorldFeed | null>(null)
  const payload = useStore(model.tasks)
  const tabs = useStore(model.tabs)
  const [beats, setBeats] = useState<readonly Beat[]>([])
  const [, setTick] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let scene: WorldScene
    try {
      scene = new WorldScene(canvas)
    } catch {
      setFailed(true)
      return
    }
    sceneRef.current = scene
    scene.pick((taskId) => {
      page.set(null)
      model.select(taskId)
    })
    scene.start()
    const feed = new WorldFeed(
      model.client,
      () => model.tasks.get()?.tasks ?? [],
      () => model.selection.get().taskId,
    )
    feedRef.current = feed
    feed.start((beat, taskId) => {
      scene.beat(beat, taskId)
      setBeats((prev) => [...prev, beat].slice(-40))
    })
    const ticker = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      window.clearInterval(ticker)
      feed.stop()
      feedRef.current = null
      scene.dispose()
      sceneRef.current = null
    }
  }, [model])

  // One snapshot per store change or second: the scene reconciles by id, so a full redraw is cheap.
  const stations = worldStations(payload, tabs, feedRef.current?.counts)
  useEffect(() => {
    sceneRef.current?.update(stations)
  }, [stations])

  const working = stations.filter((station) => station.status === "running").length
  const rate = feedRef.current?.rate ?? 0
  const tally = toolTally(beats.slice(-120))
  const files = hotFiles(beats.slice(-160))
  const frame = sceneRef.current?.frameMs ?? 0

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={t("world.title")} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-body text-muted">
          {t("world.webgl")}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto rounded-md border border-line bg-paper/85 px-3 py-2 backdrop-blur-md">
          <div className="flex items-baseline gap-2">
            <span className="text-title font-semibold tracking-code text-ink">{t("world.title").toUpperCase()}</span>
            <span className="text-meta text-muted">{t("world.working", { count: working })}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-meta text-subtle">
            <span>
              {t("world.rate")} <span className="text-ink">{rate}</span>
            </span>
            <span>{t("world.tasks", { count: stations.length })}</span>
            <span className={frame > 20 ? "text-warning" : "text-subtle"}>{frame.toFixed(1)}ms</span>
          </div>
        </div>
        <Button variant="action" className="pointer-events-auto backdrop-blur-md" onClick={() => page.set(null)}>
          {t("world.classic")}
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-line bg-paper/80 px-3 py-2 text-meta text-muted backdrop-blur-md">
        {t("world.hint")}
        <div className="mt-1 flex gap-3">
          {(["scan", "build", "run", "plan", "other"] as const).map((kind) => (
            <span key={kind} className={KIND_TONE[kind]}>
              {t(`world.kind.${kind}`)}
            </span>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3 top-20 flex w-64 flex-col gap-2 overflow-hidden">
        <Panel title={t("world.stream")}>
          {beats.length === 0 ? (
            <p className="text-meta text-subtle">{t("world.noBeats")}</p>
          ) : (
            beats
              .slice(-7)
              .reverse()
              .map((beat, index) => (
                <div key={`${beat.id}-${index}`} className="flex items-baseline gap-2 text-meta">
                  <span className={KIND_TONE[toolKind(beat.name)]}>{shortToolName(beat.name, 11)}</span>
                  <span className="truncate text-subtle">{beat.summary}</span>
                </div>
              ))
          )}
        </Panel>
        <Panel title={t("world.tools")}>
          {tally.length === 0 ? (
            <p className="text-meta text-subtle">{t("world.nothingYet")}</p>
          ) : (
            tally.map((row) => (
              <div key={row.name} className="flex items-baseline justify-between text-meta">
                <span className={KIND_TONE[toolKind(row.name)]}>{shortToolName(row.name, 12)}</span>
                <span className="text-ink">{row.count}</span>
              </div>
            ))
          )}
        </Panel>
        <Panel title={t("world.hotFiles")}>
          {files.length === 0 ? (
            <p className="text-meta text-subtle">{t("world.nothingYet")}</p>
          ) : (
            files.map((row) => (
              <div key={row.file} className="flex items-baseline justify-between gap-2 text-meta">
                <span className="truncate text-subtle">{row.file}</span>
                <span className="text-ink">{row.count}</span>
              </div>
            ))
          )}
        </Panel>
        {stations.length === 0 && (
          <Panel title={t("world.title")}>
            <p className="text-meta text-subtle">{t("world.empty")}</p>
          </Panel>
        )}
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-paper/80 px-3 py-2 backdrop-blur-md">
      <p className="mb-1 text-meta tracking-code text-subtle">{title.toUpperCase()}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
