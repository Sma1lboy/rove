// Loaded with `electron -r`: windows show without taking focus, at the tour's desktop size.
const { app } = require("electron")
app.on("browser-window-created", (_event, win) => {
  win.show = () => win.showInactive()
  if (win.isResizable()) win.setBounds({ width: 1440, height: 900 })
})
