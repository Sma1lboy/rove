// First import: takes the token out of the address bar before anything else runs.
import { storedToken } from "./auth.ts"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/700.css"
import "./styles.css"
import "./overlays.css"
import "./files.css"
import "./settings.css"
import "./workspace.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, ConnectScreen } from "./app.tsx"
import { BridgeClient, bridgeUrl } from "./bridge.ts"
import { AppModel } from "./model.ts"
import { isPromptPush, openPrompt } from "./prompt-dialog.tsx"

const root = createRoot(document.getElementById("root") as HTMLElement)
const token = storedToken()
if (!token) {
  root.render(
    <StrictMode>
      <ConnectScreen />
    </StrictMode>,
  )
} else {
  const client = new BridgeClient(bridgeUrl(), token)
  const model = new AppModel(client)
  // A plugin's `rove api prompt`; the dialog is page UI, so it is wired here, not in the model.
  client.on("prompt", (data) => {
    if (isPromptPush(data)) openPrompt(client, data)
  })
  client.start()
  root.render(
    <StrictMode>
      <App model={model} />
    </StrictMode>,
  )
}
