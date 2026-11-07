import { afterEach, beforeEach, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IlinkClient } from "../src/ilink.ts"
import { downloadMedia, messageMedia } from "../src/media.ts"
import { sendAttachment } from "../src/send.ts"
import { FAKE_OWNER, FAKE_TOKEN, FakeIlink } from "./fake-ilink.ts"

let fake: FakeIlink
let client: IlinkClient
let dir: string
const noSleep = async () => {}

beforeEach(async () => {
  fake = await new FakeIlink().start()
  client = new IlinkClient(fake.url, FAKE_TOKEN)
  dir = mkdtempSync(join(tmpdir(), "weixin-send-"))
})

afterEach(async () => {
  await fake.stop()
})

/** What the owner's phone gets back from the CDN for a sent item. */
async function received(item: Record<string, unknown>): Promise<Buffer> {
  const [ref] = messageMedia({ item_list: [item] })
  if (!ref) throw new Error("the sent item carries no CDN reference")
  return downloadMedia(ref, fetch, `${fake.url}/c2c`)
}

it("a picture goes up encrypted and the sent image item opens to the same bytes", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(1000)])
  const path = join(dir, "chart.png")
  writeFileSync(path, png)

  expect(await sendAttachment(client, FAKE_OWNER, path, "ctx-1", noSleep)).toBeNull()

  expect(fake.uploadRequests[0]).toMatchObject({
    media_type: 1,
    to_user_id: FAKE_OWNER,
    rawsize: png.length,
    rawfilemd5: createHash("md5").update(png).digest("hex"),
    // AES-128 with PKCS7 always pads to the next 16-byte block.
    filesize: Math.ceil((png.length + 1) / 16) * 16,
  })
  expect(fake.sends[0]?.contextToken).toBe("ctx-1")
  const item = fake.sentItems[0] ?? {}
  expect(item.type).toBe(2)
  expect(await received(item)).toEqual(png)
})

it("a .md goes as a file attachment under its own name", async () => {
  const md = Buffer.from("# 周报\n\n- 修了收图\n")
  const path = join(dir, "weekly.md")
  writeFileSync(path, md)

  expect(await sendAttachment(client, FAKE_OWNER, path, null, noSleep)).toBeNull()

  expect(fake.uploadRequests[0]?.media_type).toBe(3)
  const item = fake.sentItems[0] ?? {}
  expect(item).toMatchObject({ type: 4, file_item: { file_name: "weekly.md", len: String(md.length) } })
  expect(await received(item)).toEqual(md)
})

it("a CDN refusal is reported and nothing is sent", async () => {
  const path = join(dir, "photo.jpg")
  writeFileSync(path, randomBytes(64))
  fake.uploadRefusal = 413

  expect(await sendAttachment(client, FAKE_OWNER, path, null, noSleep)).toBe(
    "upload: CDN refused the upload: refused by the fake",
  )
  expect(fake.sends).toEqual([])
})
