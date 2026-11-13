/**
 * A picture of what the Browser shows, marks included. A page cannot read a cross-origin frame's pixels,
 * so the browser is asked for this tab's picture (`getDisplayMedia`, which the user allows each time)
 * and the frame's box is cut out of it. If they share the window or the screen instead, the box is found there.
 */

interface Size {
  readonly width: number
  readonly height: number
}

export interface Crop extends Size {
  readonly x: number
  readonly y: number
}

/** `box` (CSS px in a `viewport`-sized page) in the pixels of a `frame`-sized picture of that page, kept inside it. */
export function cropRect(box: Size & { left: number; top: number }, viewport: Size, frame: Size): Crop {
  const sx = frame.width / viewport.width
  const sy = frame.height / viewport.height
  const x = Math.min(frame.width, Math.max(0, Math.round(box.left * sx)))
  const y = Math.min(frame.height, Math.max(0, Math.round(box.top * sy)))
  return {
    x,
    y,
    width: Math.min(frame.width - x, Math.round(box.width * sx)),
    height: Math.min(frame.height - y, Math.round(box.height * sy)),
  }
}

/** What `pageIn` reads off `window`. */
export interface Win {
  readonly innerWidth: number
  readonly innerHeight: number
  readonly outerWidth: number
  readonly outerHeight: number
  readonly screenX: number
  readonly screenY: number
  readonly screen: Size
}

/**
 * Where the page sits in the picture the user chose to share, and that picture's size, in CSS px.
 * A tab is the page itself; a window adds the browser's bars; a screen adds the window's position.
 */
export function pageIn(surface: string | undefined, frame: Size, w: Win): Size & { left: number; top: number } {
  const page = { left: 0, top: 0, width: w.innerWidth, height: w.innerHeight }
  // ponytail: assumes the browser's bars are all above the page (no docked devtools or side panel) and,
  // for a screen, that it is the one whose corner is 0,0. Region Capture is exact, Chromium only.
  const bars = { left: (w.outerWidth - w.innerWidth) / 2, top: w.outerHeight - w.innerHeight }
  const win = { ...bars, width: w.outerWidth, height: w.outerHeight }
  const screen = { left: w.screenX + bars.left, top: w.screenY + bars.top, ...w.screen }
  const named = { browser: page, window: win, monitor: screen }[surface ?? ""]
  if (named) return named
  // Safari does not say which it sent: take the one shaped like the picture.
  const off = (s: Size) => Math.abs(s.width / s.height - frame.width / frame.height)
  return [page, win, screen].reduce((a, b) => (off(b) < off(a) ? b : a))
}

/** Needs https or localhost, and a desktop browser. */
export function canCapture(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function"
}

/** A PNG of `el` as it is on screen. Rejects with `NotAllowedError` when the user says no. */
export async function captureElement(el: HTMLElement, name: string): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  } as DisplayMediaStreamOptions)
  try {
    const video = document.createElement("video")
    video.muted = true
    video.srcObject = stream
    await video.play()
    const frame = { width: video.videoWidth, height: video.videoHeight }
    const box = el.getBoundingClientRect()
    const page = pageIn(stream.getVideoTracks()[0]?.getSettings().displaySurface, frame, window)
    const crop = cropRect(
      { left: box.left + page.left, top: box.top + page.top, width: box.width, height: box.height },
      page,
      frame,
    )
    const canvas = document.createElement("canvas")
    canvas.width = crop.width
    canvas.height = crop.height
    canvas.getContext("2d")?.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"))
    if (!blob) throw new Error("empty capture")
    return new File([blob], name, { type: "image/png" })
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}
