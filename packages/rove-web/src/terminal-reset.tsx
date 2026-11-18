import type { BridgeClient } from "./bridge.ts"
import { ConfirmDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { terminalText } from "./keymap-text.ts"
import { beginReset, endReset } from "./reset-guard.ts"
import { streamKey } from "./term-contract.ts"
import { dialog } from "./ui.ts"

export function confirmTerminalReset(
  client: BridgeClient,
  taskId: string,
  tabId: string,
  leafId: string | undefined,
  size: { cols: number; rows: number },
  restore: () => Promise<void>,
) {
  // Capture the stream and size before opening the dialog: focus can move before confirmation.
  const stream = streamKey(taskId, tabId, leafId)
  dialog.set(
    <ConfirmDialog
      title={terminalText("reset.title")}
      body={terminalText("reset.body")}
      confirmLabel={t("workspace.reset")}
      onConfirm={async () => {
        beginReset(stream)
        try {
          await client.request("tab.split", { taskId, tabId, action: "reset", leafId: leafId ?? "leaf-1", ...size })
          await restore()
        } finally {
          endReset(stream)
        }
      }}
    />,
  )
}
