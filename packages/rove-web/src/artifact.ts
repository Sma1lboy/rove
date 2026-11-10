/** What the artifact preview knows of a file: which ones it draws, how its bytes become something safe to show. */

export type ArtifactKind = "md" | "html" | "svg" | "image" | "pdf"

const BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = {
  md: "md",
  markdown: "md",
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  pdf: "pdf",
}

/** The kind of preview a path gets, by its extension; null = no preview, the diff or code view only. */
export function artifactKind(path: string): ArtifactKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot < 0 ? null : (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null)
}

/** The bytes behind a `file.read` reply's base64. */
export function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const textOf = (base64: string): string => new TextDecoder().decode(bytesOf(base64))

/** The type a blob is made with. Chosen here from the path, not taken from the reply: a bridge cannot make an image a page. */
export function blobType(kind: "svg" | "image" | "pdf", path: string): string {
  if (kind === "svg") return "image/svg+xml"
  if (kind === "pdf") return "application/pdf"
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  return ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "gif"
      ? "image/gif"
      : ext === "webp"
        ? "image/webp"
        : "image/png"
}

/**
 * An HTML report's source for the preview frame: no network, no scripts, no frames, no forms. The frame is also
 * sandboxed (`sandbox=""`), so this is the second lock: a page that loads nothing cannot leak what it reads. The
 * policy comes first (after a doctype, which must stay first for standards mode), so nothing in the file precedes it.
 */
export const HTML_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"

export function htmlDocument(source: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${HTML_POLICY}">`
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source)
  return doctype ? `${doctype[0]}${meta}${source.slice(doctype[0].length)}` : `${meta}${source}`
}
