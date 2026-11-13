/**
 * A picture of what the Browser shows, marks included. A page cannot read a cross-origin frame's pixels,
 * so the browser is asked for this tab's picture (`getDisplayMedia`, which the user allows each time)
 * and the frame's box is cut out of it.
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

/** Needs https or localhost, and a desktop browser. */
export function canCapture(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function"
}

/** A PNG of `el` as it is on screen. Rejects with `NotAllowedError` when the user says no. */
export async function captureElement(el: HTMLElement, name: string): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    preferCurrentTab: true,
  } as DisplayMediaStreamOptions)
  try {
    const video = document.createElement("video")
    video.muted = true
    video.srcObject = stream
    await video.play()
    const frame = { width: video.videoWidth, height: video.videoHeight }
    // ponytail: only a picture of this tab can be cut to the frame; a browser that offers a window or
    // screen instead (Safari, Firefox) sends the whole picture. Crop by Region Capture if that matters.
    const tab = stream.getVideoTracks()[0]?.getSettings().displaySurface === "browser"
    const crop = tab
      ? cropRect(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, frame)
      : { x: 0, y: 0, ...frame }
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
