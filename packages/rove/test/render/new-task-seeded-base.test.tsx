/** @jsxImportSource @opentui/react */
/**
 * "New task from this branch" opens the dialog through `NewTaskDialog.show`
 * with `initialBaseRef`. The flow test sees the option leave the flow; only a
 * mounted dialog sees whether the branch field shows it instead of the repo's
 * checked-out branch, which the field otherwise auto-syncs to.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useEffect, useRef } from "react"
import { NewTaskDialog } from "../../src/tui-react/component/new-task-dialog"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { isolateHome, renderComponent, settle } from "./harness"

isolateHome()

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-seeded-base-"))
  execSync(
    "git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git branch feat/schema",
    { cwd: dir },
  )
  return dir
}

function Harness(props: { repo: string; initialBaseRef?: string }) {
  const dialog = useDialog()
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void NewTaskDialog.show(dialog, props.repo, [props.repo], { initialBaseRef: props.initialBaseRef })
  }, [dialog, props.repo, props.initialBaseRef])
  return <box />
}

async function baseRow(dir: string, initialBaseRef?: string): Promise<string> {
  const { frame } = await renderComponent(<Harness repo={dir} initialBaseRef={initialBaseRef} />, {
    width: 100,
    height: 64,
    providers: { kv: true, dialog: true },
  })
  await settle()
  const lines = (await frame()).split("\n")
  const at = lines.findIndex((line) => line.includes("FROM BRANCH"))
  expect(at).toBeGreaterThanOrEqual(0)
  // The label row, then the input row under it.
  return lines.slice(at, at + 3).join("\n")
}

test("a seeded base branch replaces the repo's checked-out one", async () => {
  const dir = repo()
  expect(await baseRow(dir)).not.toContain("feat/schema")
  expect(await baseRow(dir, "feat/schema")).toContain("feat/schema")
})
