// First import: takes the token out of the address bar before anything else runs.
import { storedToken } from "./auth.ts"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/700.css"
import "./styles.css"
import "./overlays.css"
import "./files.css"
import "./settings.css"
import "./workspace.css"
import "./side-panel.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, ConnectScreen } from "./app.tsx"
import { BridgeClient, bridgeUrl } from "./bridge.ts"
import { trapDialogFocus } from "./focus-trap.ts"
import { watchLeaving } from "./leave.ts"
import { LoginScreen } from "./login-view.tsx"
import { passwordLoginOn } from "./login.ts"
import { longPressOpensMenus } from "./long-press.ts"
import { AppModel } from "./model.ts"
import { isPromptPush, openPrompt } from "./prompt-dialog.tsx"
import { watchBridgeVersion } from "./version-reload.ts"
import { followVisualViewport } from "./viewport.ts"

const root = createRoot(document.getElementById("root") as HTMLElement)
followVisualViewport()
longPressOpensMenus()
watchLeaving()
trapDialogFocus()
const token = storedToken()
if (!token) {
  // With a password set on the host, a page without a token signs in instead of asking for the link.
  void passwordLoginOn().then((password) =>
    root.render(<StrictMode>{password ? <LoginScreen /> : <ConnectScreen />}</StrictMode>),
  )
} else {
  const client = new BridgeClient(bridgeUrl(), token)
  const model = new AppModel(client)
  // A plugin's `rove api prompt`; the dialog is page UI, so it is wired here, not in the model.
  client.on("prompt", (data) => {
    if (isPromptPush(data)) openPrompt(client, data)
  })
  // An upgrade restarts the bridge under the open page: reload once into the new client.
  watchBridgeVersion(client)
  client.start()
  root.render(
    <StrictMode>
      <App model={model} />
    </StrictMode>,
  )
}
