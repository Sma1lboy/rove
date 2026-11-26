/** A file sent from another machine for an agent here: written under this home's attachments, one part per call. */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/** The name the sender generated: one path segment, nothing a shell would need quoted. */
const NAME = /^attach-[\p{L}\p{N}_-]+\.[A-Za-z0-9]{1,10}$/u

export const ATTACHMENT_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "attachment.append",
    async handle(payload, ctx) {
      const name = requireString(payload, "name")
      if (!NAME.test(name)) throw new Error("name is not an attachment file name")
      const offset = requireNumber(payload, "offset")
      const data = typeof payload.data === "string" ? payload.data : ""
      if (!ctx.daemon.homeDir) throw new Error("this daemon has no home to store attachments in")
      const dir = join(ctx.daemon.homeDir, ".rove", "attachments")
      const path = join(dir, name)
      if (offset === 0) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(path, "", { mode: 0o600, flag: "wx" })
      }
      // A part sent twice, or out of turn, must not land in the file.
      const have = statSync(path, { throwIfNoEntry: false })?.size
      if (have !== offset) throw new Error(`the file stands at ${have ?? "nothing"}, not ${offset}`)
      const bytes = Buffer.from(data, "base64")
      appendFileSync(path, bytes)
      return { path, bytes: offset + bytes.length }
    },
  },
]
