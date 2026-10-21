import { describe, expect, test } from "vitest"
import { INBOUND_KEY, inboundClassOf, inboundRefusal } from "../../src/machines/inbound.ts"

describe("inbound policy for forwarded verbs", () => {
  test("verbs are judged by their group, and land/publish by their own class", () => {
    expect(inboundClassOf("get-task")).toBe("read")
    expect(inboundClassOf("add")).toBe("create")
    expect(inboundClassOf("land")).toBe("land")
    expect(inboundClassOf("publish")).toBe("land")
    expect(inboundClassOf("no-such-verb")).toBeNull()
  })

  test("nothing is denied by default, landing included", () => {
    expect(inboundRefusal("land", {})).toBeNull()
    expect(inboundRefusal("add", {})).toBeNull()
  })

  test("a denied class refuses exactly its verbs", () => {
    const state = { [INBOUND_KEY]: { deny: ["land"] } }
    expect(inboundRefusal("publish", state)).toBe("land")
    expect(inboundRefusal("land", state)).toBe("land")
    expect(inboundRefusal("get-task", state)).toBeNull()
  })
})
