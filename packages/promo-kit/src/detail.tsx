import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { type Item, MOBILE, copy, fmtDur, fmtSize, linkBtn, primaryBtn, toast, videoWarnings, vurl } from "./lib.ts"
import { X_MAX, xLength } from "./xcount.ts"

// Edits stay in this page's state; nothing is written back to the library.
export function Detail({ item }: { item: Item }) {
  const [posts, setPosts] = useState(item.posts)
  const [dims, setDims] = useState<{ w: number; h: number }>()
  const warns = videoWarnings(item.video, dims)

  useEffect(() => {
    document.title = `${item.title} · Rove 宣发包`
  }, [item])

  return (
    <>
      <a href="#/" className="text-meta text-muted hover:underline">
        ← 全部素材
      </a>
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <section className="lg:sticky lg:top-18">
          <video
            className="block max-h-[70vh] w-full rounded-md bg-inset"
            src={vurl(item.video.key)}
            poster={item.cover && vurl(item.cover)}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
          <h1 className="mt-3 text-display font-semibold">{item.title}</h1>
          <p className="mt-1 font-mono text-meta text-subtle">
            {[fmtDur(item.video.duration), fmtSize(item.video.size)].filter(Boolean).join(" · ")}
          </p>
          {warns.length > 0 && (
            <ul className="mt-3 rounded-sm border border-line px-3 py-2 text-meta text-warning">
              <li className="text-muted">X 可能不收这个视频：</li>
              {warns.map((w) => (
                <li key={w}>! {w}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-line bg-surface">
          <ol>
            {posts.map((p, i) => (
              <Post
                // biome-ignore lint/suspicious/noArrayIndexKey: posts never reorder
                key={i}
                index={i}
                total={posts.length}
                text={p}
                duration={i === 0 ? item.video.duration : undefined}
                onChange={(v) => setPosts((ps) => ps.map((x, j) => (j === i ? v : x)))}
              />
            ))}
          </ol>
          <SendBar item={item} text={posts[0].trim()} thread={posts.length > 1} />
        </section>
      </div>
    </>
  )
}

function Post(props: { index: number; total: number; text: string; duration?: number; onChange: (v: string) => void }) {
  const { index, total, text } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const a = ref.current
    if (!a) return
    a.style.height = "auto"
    a.style.height = `${a.scrollHeight}px`
  }, [text])
  const n = xLength(text.trim())
  const thread = total > 1

  const onCopy = async () => {
    if (!(await copy(text.trim()))) return toast("复制失败，长按文字手动复制")
    toast(index === 0 ? "已复制" : `第 ${index + 1} 条已复制，回复到上一条下面`)
  }

  return (
    <li className="flex gap-3 px-4">
      {thread && (
        <div className="flex w-6 flex-none flex-col items-center">
          <span className={`h-4 w-px ${index > 0 ? "bg-line" : ""}`} />
          <span className="grid size-6 place-items-center rounded-full border border-line font-mono text-meta text-muted">
            {index + 1}
          </span>
          {index < total - 1 && <span className="w-px flex-1 bg-line" />}
        </div>
      )}
      <div className="min-w-0 flex-1 pt-4 pb-3">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => props.onChange(e.target.value)}
          aria-label={`第 ${index + 1} 条文案`}
          className="-mx-2 block w-[calc(100%+16px)] resize-none rounded-sm bg-transparent px-2 py-1 text-title leading-relaxed text-ink outline-none hover:bg-hover focus:bg-hover touch:text-display"
        />
        {props.duration !== undefined && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 font-mono text-meta text-muted">
            ▶ 视频 {fmtDur(props.duration)}
          </div>
        )}
        <div className="mt-2 flex items-center justify-end gap-4">
          <span className={`font-mono text-meta ${n > X_MAX ? "text-error" : "text-subtle"}`} title="按 X 规则：中文 2，链接 23">
            {n}/{X_MAX}
          </span>
          <button type="button" className={linkBtn} onClick={onCopy}>
            复制
          </button>
        </div>
      </div>
    </li>
  )
}

// navigator.share must run inside the tap, so on phones the video is fetched ahead of time.
function useVideoFile(item: Item, enabled: boolean) {
  const [state, setState] = useState<{ file?: File; pct: number; failed?: boolean }>({ pct: 0 })
  useEffect(() => {
    if (!enabled) return
    const ac = new AbortController()
    ;(async () => {
      const r = await fetch(vurl(item.video.key), { signal: ac.signal })
      if (!r.ok || !r.body) throw new Error(String(r.status))
      const reader = r.body.getReader()
      const chunks: BlobPart[] = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value as BlobPart)
        got += value.length
        const pct = Math.round((got / item.video.size) * 100)
        setState((s) => (s.pct === pct ? s : { pct }))
      }
      setState({ file: new File(chunks, `${item.id}.mp4`, { type: "video/mp4" }), pct: 100 })
    })().catch(() => {
      if (!ac.signal.aborted) setState({ pct: 0, failed: true })
    })
    return () => ac.abort()
  }, [item, enabled])
  return state
}

function SendBar({ item, text, thread }: { item: Item; text: string; thread: boolean }) {
  const media = useVideoFile(item, MOBILE)
  const file = `${item.id}.mp4`
  const dl = `${vurl(item.video.key)}?dl=${encodeURIComponent(file)}`

  const send = async () => {
    if (MOBILE && media.file) {
      const copied = copy(text) // same tap as share; not awaited so share keeps the gesture
      try {
        await navigator.share({ files: [media.file], text })
        toast((await copied) ? "文案已复制，X 里没带上文字就粘贴" : "X 里没带上文字的话，回来点「复制」", 6000)
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast(`分享失败：${(e as Error).message}。先下载视频再手动发`, 6000)
      }
      return
    }
    const a = document.createElement("a")
    a.href = dl
    a.download = file
    a.click()
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener")
    toast(thread ? "视频在下载。拖进 X 发帖框发出，再在下面逐条回复后几条" : "视频在下载。拖进 X 发帖框，检查后再发", 7000)
  }

  const waiting = MOBILE && !media.file
  const label = !waiting ? "发到 X" : media.failed ? "视频加载失败，先下载" : `准备视频 ${media.pct}%`

  return (
    <div className="sticky bottom-0 flex items-center gap-4 rounded-b-md border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:static lg:pb-3">
      <button type="button" className={`${primaryBtn} touch:flex-1`} disabled={waiting} onClick={send}>
        {label}
      </button>
      <a className={linkBtn} href={dl} download={file}>
        下载视频
      </a>
    </div>
  )
}
