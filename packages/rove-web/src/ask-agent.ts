/**
 * "Ask an agent to change this": a Scratch session (cwd `$HOME`) whose default engine starts on `prompt`,
 * then Settings closes so the session is in view. Settings rereads its files when it opens again, which is
 * how the agent's edit shows up.
 */

import type { AppModel } from "./model.ts"
import { openTab } from "./task-dialogs.tsx"
import { closeDialog } from "./ui.ts"

export async function askAgent(model: AppModel, prompt: string): Promise<void> {
  const { taskId } = await model.client.request<{ taskId: string }>("task.openScratch")
  await openTab(model, taskId, { kind: "engine", prompt })
  closeDialog()
}
