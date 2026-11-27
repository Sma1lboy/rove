import { expect, test } from "bun:test"
import { fileTargets } from "../src/attachments.tsx"

const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 50 }) }
const drag = (types: string[], files: File[] = [], at = { x: 10, y: 10 }) => {
  let prevented = false
  const event = {
    dataTransfer: { types, files },
    currentTarget: box,
    clientX: at.x,
    clientY: at.y,
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: () => {},
  }
  return { event: event as never, prevented: () => prevented }
}

test("a photo dropped on the composer reaches the attach path; a text drag does not", () => {
  const attached: File[][] = []
  const over: boolean[] = []
  const { drop } = fileTargets(
    (files) => attached.push(files),
    (on) => over.push(on),
  )
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "IMG_0001.jpg", { type: "image/jpeg" })

  const hover = drag(["Files"], [photo])
  drop.onDragOver(hover.event)
  // Without preventDefault on dragover the browser never fires drop on the box.
  expect(hover.prevented()).toBe(true)
  const release = drag(["Files"], [photo])
  drop.onDrop(release.event)
  expect(release.prevented()).toBe(true)
  expect(attached).toEqual([[photo]])
  expect(over).toEqual([true, false])

  const text = drag(["text/plain"])
  drop.onDragOver(text.event)
  drop.onDrop(text.event)
  expect(text.prevented()).toBe(false)
  expect(attached).toHaveLength(1)
})

test("the drop ring stays while the finger crosses the box's children and goes when it leaves the box", () => {
  const over: boolean[] = []
  const { drop } = fileTargets(
    () => {},
    (on) => over.push(on),
  )
  drop.onDragLeave(drag(["Files"], [], { x: 50, y: 25 }).event)
  expect(over).toEqual([])
  drop.onDragLeave(drag(["Files"], [], { x: 150, y: 25 }).event)
  expect(over).toEqual([false])
})
