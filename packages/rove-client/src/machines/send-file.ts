/**
 * Copy one local file into another machine's `<home>/.rove/attachments`, where that machine's own
 * sweep ages it out: a file pasted for an agent that runs there has to be readable there.
 * The bytes cross the forwarded daemon socket in parts (`attachment.append`); ssh's stdin is no way
 * in, since a Windows login shell reads some of it first.
 */

import { closeSync, openSync, readSync } from "node:fs"
import { basename } from "node:path"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { machineDaemonSocket } from "@sma1lboy/rove-core/machines/forward.ts"
import type { MachineEntry } from "@sma1lboy/rove-core/machines/registry.ts"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"

/** One call's share of the file. */
const PART_BYTES = 1024 * 1024

/** Resolves to the file's path on that machine; the file keeps its name. */
export async function sendFileToMachine(entry: MachineEntry, localPath: string): Promise<string> {
  const socket = await machineDaemonSocket(entry)
  if (!socket) throw new Error(`machine ${entry.alias} cannot be reached`)
  const client = new RoveDaemonClient(socket)
  const fd = openSync(localPath, "r")
  try {
    const part = Buffer.alloc(PART_BYTES)
    let path = ""
    for (let offset = 0; ; ) {
      const read = readSync(fd, part, 0, PART_BYTES, offset)
      // An empty file is still one call: it has to exist there.
      if (read === 0 && offset > 0) return path
      const res = await client.request<{ path: string }>("attachment.append", {
        name: basename(localPath),
        offset,
        data: part.subarray(0, read).toString("base64"),
      })
      path = res.path
      offset += read
      if (read < PART_BYTES) return path
    }
  } catch (err) {
    if (/unknown daemon request/.test(errorMessage(err))) {
      throw new Error(`Rove on ${entry.alias} is too old to receive files: run rove machine update ${entry.alias}`)
    }
    throw err
  } finally {
    closeSync(fd)
    client.close()
  }
}
