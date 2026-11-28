import { describe, expect, test } from "bun:test"
import { type RawAxNode, buildSnapshot } from "../src/browser-snapshot"

const SAMPLE_TREE: RawAxNode[] = [
  { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "App" }, childIds: ["2", "3", "7"] },
  {
    nodeId: "2",
    role: { value: "heading" },
    name: { value: "Sign in" },
    properties: [{ name: "level", value: { value: 1 } }],
    backendDOMNodeId: 101,
  },
  {
    nodeId: "3",
    role: { value: "form" },
    name: { value: "Login" },
    backendDOMNodeId: 102,
    childIds: ["4", "5", "6"],
  },
  {
    nodeId: "4",
    role: { value: "textbox" },
    name: { value: "Email" },
    value: { value: "alice@example.com" },
    properties: [
      { name: "focused", value: { value: true } },
      { name: "required", value: { value: true } },
    ],
    backendDOMNodeId: 103,
  },
  {
    nodeId: "5",
    role: { value: "checkbox" },
    name: { value: "Remember me" },
    properties: [{ name: "checked", value: { value: "true" } }],
    backendDOMNodeId: 104,
  },
  {
    nodeId: "6",
    role: { value: "button" },
    name: { value: "Continue" },
    properties: [{ name: "disabled", value: { value: true } }],
    backendDOMNodeId: 105,
  },
  {
    nodeId: "7",
    role: { value: "navigation" },
    name: { value: "Footer" },
    backendDOMNodeId: 106,
    childIds: ["8", "9"],
  },
  {
    nodeId: "8",
    role: { value: "link" },
    name: { value: "Help" },
    backendDOMNodeId: 107,
  },
  {
    nodeId: "9",
    ignored: true,
    role: { value: "button" },
    name: { value: "Hidden" },
    backendDOMNodeId: 108,
  },
]

describe("buildSnapshot", () => {
  test("produces compact lines, skips ignored nodes, and maps @eN refs to backendDOMNodeId", () => {
    const snap = buildSnapshot(SAMPLE_TREE)
    expect(snap).not.toBeNull()
    expect(snap!.truncated).toBe(false)
    expect(snap!.nodes.map((n) => `${n.ref}:${n.role}:${n.name}`)).toEqual([
      "@e1:heading:Sign in",
      "@e2:form:Login",
      "@e3:textbox:Email",
      "@e4:checkbox:Remember me",
      "@e5:button:Continue",
      "@e6:navigation:Footer",
      "@e7:link:Help",
    ])
    expect(snap!.refs.get("@e2")).toBe(102)
    expect(snap!.refs.get("@e5")).toBe(105)
    expect(snap!.text).toContain('@e3 [textbox] "Email" value="alice@example.com" focused required')
    expect(snap!.text).toContain('@e4 [checkbox] "Remember me" checked')
    expect(snap!.text).toContain('@e5 [button] "Continue" disabled')
    expect(snap!.text).not.toContain("Hidden")
  })

  test("--interactive keeps only interactive controls", () => {
    const snap = buildSnapshot(SAMPLE_TREE, { interactive: true })
    expect(snap!.nodes.map((n) => n.role)).toEqual(["textbox", "checkbox", "button", "link"])
    expect(snap!.nodes.every((n) => n.interactive)).toBe(true)
  })

  test("--root scopes traversal to the ref subtree and returns null when detached", () => {
    const first = buildSnapshot(SAMPLE_TREE)!
    const formBackendId = first.refs.get("@e2")!
    const scoped = buildSnapshot(SAMPLE_TREE, { rootBackendNodeId: formBackendId, interactive: true })!
    expect(scoped.nodes.map((n) => n.name)).toEqual(["Email", "Remember me", "Continue"])
    expect(buildSnapshot(SAMPLE_TREE, { rootBackendNodeId: 99999 })).toBeNull()
  })

  test("caps nodes at maxNodes and reports truncation", () => {
    const snap = buildSnapshot(SAMPLE_TREE, { maxNodes: 3 })!
    expect(snap.nodes).toHaveLength(3)
    expect(snap.totalNodes).toBe(7)
    expect(snap.truncated).toBe(true)
  })
})
