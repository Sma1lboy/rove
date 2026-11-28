/**
 * Unit tests for the folder-picker pure helpers (`src/tui/component/new-task-dialog/folder-picker.ts`).
 */

import {
  NO_FOLDER,
  OPEN_FOLDER_ROW,
  buildSavedPicker,
  duplicateBasenames,
  initialBrowseDir,
  stripPathQuotes,
} from "@/tui/component/new-task-dialog/folder-picker"
import { describe, expect, it } from "vitest"

describe("duplicateBasenames", () => {
  it("returns empty when every saved repo has a distinct basename", () => {
    expect(duplicateBasenames(["/work/rove", "/work/curlew"]).size).toBe(0)
  })

  it("flags basenames shared across paths case-insensitively", () => {
    const dupes = duplicateBasenames(["/a/App", "/b/app", "/c/unique"])
    expect(dupes.has("app")).toBe(true)
    expect(dupes.has("unique")).toBe(false)
  })
})

describe("initialBrowseDir", () => {
  it("starts at the selected folder's parent so sibling folders appear immediately", () => {
    expect(initialBrowseDir("/work/projects/rove", "", "/Users/me")).toBe("/work/projects/")
  })

  it("falls back to home with a trailing slash when no folder is selected", () => {
    expect(initialBrowseDir("", "", "/Users/me")).toBe("/Users/me/")
  })
})

describe("buildSavedPicker", () => {
  const repos = ["/work/rove", "/work/curlew"]

  it("leads with No folder, lists Recent, and pins Open folder… at the bottom", () => {
    const model = buildSavedPicker({ noFolderLabel: "No folder", repoOptions: repos, query: "" })
    expect(model.showNoFolder).toBe(true)
    expect(model.recent).toEqual(repos)
    expect(model.items).toEqual([NO_FOLDER, "/work/rove", "/work/curlew", OPEN_FOLDER_ROW])
  })

  it("keeps Open folder… reachable even when a search query matches nothing", () => {
    const model = buildSavedPicker({ noFolderLabel: "No folder", repoOptions: repos, query: "zzz" })
    expect(model.showNoFolder).toBe(false)
    expect(model.recent).toEqual([])
    expect(model.items).toEqual([OPEN_FOLDER_ROW])
  })
})

describe("stripPathQuotes", () => {
  it("strips matching single or double quotes around a pasted filepath", () => {
    expect(stripPathQuotes('"/Users/me/projects/rove"')).toBe("/Users/me/projects/rove")
    expect(stripPathQuotes("'/Users/me/my folder'")).toBe("/Users/me/my folder")
    expect(stripPathQuotes("/Users/me/plain")).toBe("/Users/me/plain")
  })
})
