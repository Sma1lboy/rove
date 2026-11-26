/** @jsxImportSource @opentui/react */
/**
 * "New task from this branch" opens the New task page with `initialBaseRef`.
 * The flow test sees the option leave the flow; only a mounted page sees whether the branch field shows it instead of the repo's
 * checked-out branch, which the field otherwise auto-syncs to.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskPage } from "../../src/tui-react/component/new-task-dialog"
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
  return (
    <NewTaskPage
      defaultRepo={props.repo}
      savedRepos={[props.repo]}
      options={{ initialBaseRef: props.initialBaseRef }}
      focused
      onDone={() => {}}
    />
  )
}

async function baseRow(dir: string, initialBaseRef?: string): Promise<string> {
  const { frame } = await renderComponent(<Harness repo={dir} initialBaseRef={initialBaseRef} />, {
    width: 100,
    height: 64,
    providers: { kv: true, dialog: true },
  })
  await settle()
  // The branch chip's row: the one that also carries the repo and engine chips.
  return (await frame()).split("\n").find((line) => line.includes("claude")) ?? ""
}

test("a seeded base branch replaces the repo's checked-out one", async () => {
  const dir = repo()
  expect(await baseRow(dir)).not.toContain("feat/schema")
  expect(await baseRow(dir, "feat/schema")).toContain("feat/schema")
})
