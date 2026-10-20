import { expect, test } from "vitest"
import { showSharedFilesHint } from "../../src/tui-react/workspace/shared-files-hint"
import { t } from "../../src/tui/i18n"

test("the shared-files hint is persisted once across tab mounts", () => {
  const store = new Map<string, unknown>()
  const kv = {
    get: (key: string) => store.get(key),
    setQuiet: (key: string, value: unknown) => {
      store.set(key, value)
    },
  }
  const messages: string[] = []
  const show = () => showSharedFilesHint(kv, (title, body) => messages.push(`${title}: ${body}`), t)
  show()
  show()
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain("n: new task, isolated worktree")
})
