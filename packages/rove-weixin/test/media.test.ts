import { expect, it } from "bun:test"
import { messageMedia } from "../src/media.ts"

const image = (param: string) => ({ type: 2, image_item: { media: { encrypt_query_param: param } } })

it("a reply that quotes a picture brings that picture, unless it carries media of its own", () => {
  const quoting = { type: 1, text_item: { text: "这是什么" }, ref_msg: { message_item: image("quoted") } }
  expect(messageMedia({ item_list: [quoting] }).map((ref) => ref.media.encrypt_query_param)).toEqual(["quoted"])
  expect(messageMedia({ item_list: [quoting, image("own")] }).map((ref) => ref.media.encrypt_query_param)).toEqual([
    "own",
  ])
  // An item with no CDN reference is nothing to download.
  expect(messageMedia({ item_list: [{ type: 2, image_item: {} }] })).toEqual([])
})
