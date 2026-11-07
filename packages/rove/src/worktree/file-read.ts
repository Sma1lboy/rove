/**
 * One previewable file's bytes from a task's worktree, for a client that renders it (markdown, an image, a PDF,
 * an HTML report). Read-only and confined: a worktree-relative path whose REAL path (symlinks resolved) stays
 * inside the worktree's real path, of an allowlisted type, up to {@link FILE_READ_MAX_BYTES}. Like the other
 * `worktree-*` reads it runs in the daemon that owns the worktree, so a hub reads a task on another machine.
 */

import { open, realpath } from "node:fs/promises"
import { extname, join, sep } from "node:path"
import { ApiError } from "../cli/api/types.ts"
import { isWorktreeRelative } from "./review-read.ts"

/** Raw bytes; the reply carries them base64, a third larger. */
export const FILE_READ_MAX_BYTES = 5 * 1024 * 1024

/** The types a preview can draw. The extension of the file's REAL path decides, so a symlink cannot rename a type. */
const MIME: Readonly<Record<string, string>> = {
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
}

export interface PreviewFile {
  readonly path: string
  readonly mime: string
  readonly size: number
  readonly base64: string
}

async function realpathOrMissing(path: string, shown: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    throw new ApiError(`${shown} does not exist`, "NOT_FOUND")
  }
}

export async function readPreviewFile(worktreePath: string, rel: string): Promise<PreviewFile> {
  if (rel === "" || rel.includes("\0") || !isWorktreeRelative(rel)) {
    throw new ApiError("path must be relative to the worktree", "BAD_ARGS")
  }
  const root = await realpathOrMissing(worktreePath, "the worktree")
  const real = await realpathOrMissing(join(worktreePath, rel), rel)
  // A symlink may not carry the read out of the worktree.
  if (!real.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new ApiError("path is outside the worktree", "BAD_ARGS")
  }
  const mime = MIME[extname(real).slice(1).toLowerCase()]
  if (!mime) {
    throw new ApiError("only markdown, HTML, SVG, images and PDFs preview", "NOT_PREVIEWABLE", {
      hint: "read other files through the Files pane's diff or code view",
    })
  }
  const file = await open(real, "r")
  try {
    const { size, isFile } = await file.stat().then((s) => ({ size: s.size, isFile: s.isFile() }))
    if (!isFile) throw new ApiError(`${rel} is not a regular file`, "NOT_PREVIEWABLE")
    if (size > FILE_READ_MAX_BYTES) {
      throw new ApiError(`${rel} is ${size} bytes; a preview reads at most ${FILE_READ_MAX_BYTES}`, "TOO_LARGE", {
        size,
      })
    }
    // One byte over the size just read: a file that grew since the stat is refused, never truncated.
    const buffer = Buffer.allocUnsafe(size + 1)
    const { bytesRead } = await file.read(buffer, 0, size + 1, 0)
    if (bytesRead > size) throw new ApiError(`${rel} changed while it was read`, "TOO_LARGE")
    return { path: rel, mime, size: bytesRead, base64: buffer.subarray(0, bytesRead).toString("base64") }
  } finally {
    await file.close()
  }
}
