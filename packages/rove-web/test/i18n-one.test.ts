import { describe, expect, test } from "bun:test"
import { t } from "../src/i18n/index.ts"

describe("t", () => {
  test("a count of one reads the key's One sibling, other counts the key", () => {
    expect(t("review.count", { count: 1 })).toBe("1 comment")
    expect(t("review.count", { count: 2 })).toBe("2 comments")
    expect(t("preview.sent", { count: 0 })).toBe("sent 0 notes to the engine")
  })
})
