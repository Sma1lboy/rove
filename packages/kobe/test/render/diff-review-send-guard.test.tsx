/** @jsxImportSource @opentui/react */
/**
 * `s` must not mark review notes sent when nothing was delivered.
 *
 * This is the failure that photographs as success: the send closure returned
 * `undefined` whether it pasted or not, so a task with no engine session had
 * its whole batch marked sent — footer `0 unsent`, warning paint cleared, notes
 * unrecoverable. A frame that looks right is exactly the symptom, so the
 * assertion is the footer count after the keypress, plus the toast that now
 * says why.
 *
 * The overlay is mounted directly rather than through `PreviewScreen`: the
 * screen's data comes from `loadPreviewData` against a real worktree, which
 * would make this a filesystem test of something that is purely a delivery
 * contract.
 */

import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DiffRenderable } from "@opentui/core"
import { useRef, useState } from "react"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { PreviewScreen } from "../../src/tui-react/ops/preview"
import { useDiffReview } from "../../src/tui-react/ops/preview-review"
import {
  type DiffComment,
  type DiffCommentsKv,
  buildDiffReview,
  diffCommentsKey,
  unsentComments,
} from "../../src/tui/ops/diff-comments"
import { renderComponent, settle, waitForFrameText } from "./harness"

const DIFF = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,1 +1,3 @@", " const a = 1", "+const b = 2", "+const c = 3"].join("\n")
const REL = "a.ts"

function memoryKv(): DiffCommentsKv & { read: () => readonly DiffComment[] } {
  const store = new Map<string, unknown>()
  return {
    get: (k, d) => store.get(k) ?? d,
    set: (k, v) => store.set(k, v),
    read: () => (store.get(diffCommentsKey("t1")) as DiffComment[] | undefined) ?? [],
  }
}

/** The overlay over a real `<diff>`, with the same kv-backed review the
 *  workspace builds. `tick` stands in for the KV context's re-render. */
function ReviewHarness(props: { kv: DiffCommentsKv; deliver: boolean }) {
  const diffRef = useRef<DiffRenderable | null>(null)
  const [, setTick] = useState(0)
  const inner = buildDiffReview(props.kv, "t1", () => props.deliver)
  const review = {
    comments: inner.comments,
    add: (input: Parameters<typeof inner.add>[0]) => {
      inner.add(input)
      setTick((n) => n + 1)
    },
    remove: (id: string) => {
      inner.remove(id)
      setTick((n) => n + 1)
    },
    send: () => {
      const ok = inner.send()
      setTick((n) => n + 1)
      return ok
    },
  }
  const { footer } = useDiffReview({ review, relPath: REL, diffText: DIFF, focused: true, diffRef })
  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1}>
        <diff
          ref={(r: DiffRenderable | null) => {
            diffRef.current = r
          }}
          diff={DIFF}
          view="unified"
          wrapMode="none"
          showLineNumbers={true}
        />
      </box>
      {footer}
      {/* The provider only queues; the overlay is what paints — and "did the
          user see it" is the assertion this file exists for. */}
      <ToastOverlay />
    </box>
  )
}

/** `c` → the shared note dialog → text → enter. */
async function writeNote(
  handle: Awaited<ReturnType<typeof renderComponent>>,
  body: string,
  location: string,
): Promise<void> {
  handle.mockInput.typeText("c")
  await waitForFrameText(handle.frame, location)
  handle.mockInput.typeText(body)
  await settle(60)
  handle.mockInput.pressEnter()
  await settle(150)
}

test("s keeps the notes unsent and says why when there is no engine session", async () => {
  const kv = memoryKv()
  const handle = await renderComponent(<ReviewHarness kv={kv} deliver={false} />, {
    width: 80,
    height: 20,
    providers: { dialog: true, notifications: true },
  })
  await settle(120)
  await writeNote(handle, "please rename this", "Review note")
  expect(await handle.frame()).toContain("1 notes · 1 unsent")

  handle.mockInput.typeText("s")
  await settle(200)

  // The note survived and is still pending — the count is the whole assertion.
  expect(await handle.frame()).toContain("1 notes · 1 unsent")
  expect(unsentComments(kv.read())).toHaveLength(1)
  // …and the refusal is on screen rather than in a log nobody can read.
  expect(await handle.frame()).toContain("No engine session")
})

test("s still marks them sent once delivery answers", async () => {
  const kv = memoryKv()
  const handle = await renderComponent(<ReviewHarness kv={kv} deliver={true} />, {
    width: 80,
    height: 20,
    providers: { dialog: true, notifications: true },
  })
  await settle(120)
  await writeNote(handle, "please rename this", "Review note")
  handle.mockInput.typeText("s")
  await settle(200)

  expect(await handle.frame()).toContain("1 notes · 0 unsent")
  expect(unsentComments(kv.read())).toHaveLength(0)
})

test("x drops the note under the cursor", async () => {
  const kv = memoryKv()
  const handle = await renderComponent(<ReviewHarness kv={kv} deliver={false} />, {
    width: 80,
    height: 20,
    providers: { dialog: true, notifications: true },
  })
  await settle(120)
  await writeNote(handle, "typo", "Review note")
  expect(await handle.frame()).toContain("1 notes")

  handle.mockInput.typeText("x")
  await settle(200)

  expect(await handle.frame()).toContain("0 notes · 0 unsent")
  expect(kv.read()).toHaveLength(0)
})

/* --------- `r` reloads the tab that is meant to stay open --------- */

const scratch = mkdtempSync(join(tmpdir(), "rove-preview-reload-"))
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test("r re-reads the file the diff tab is showing", async () => {
  // The workspace diff tab is documented as something you keep open while the
  // engine works, so its contents go stale under you. The load was one-shot.
  writeFileSync(join(scratch, "note.txt"), "FIRST CONTENT\n")
  const { frame, mockInput } = await renderComponent(
    <PreviewScreen worktree={scratch} relPath="note.txt" focused={true} onClose={() => {}} />,
    { width: 60, height: 12, providers: { dialog: true, notifications: true } },
  )
  await waitForFrameText(frame, "FIRST CONTENT")

  writeFileSync(join(scratch, "note.txt"), "SECOND CONTENT\n")
  // Without the reload tick the frame keeps the first read forever.
  expect(await frame()).not.toContain("SECOND CONTENT")

  mockInput.typeText("r")
  await waitForFrameText(frame, "SECOND CONTENT")
})
