import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `bun run dev` serves the page with HMR and proxies the socket to a bridge
// already running on 7878 (`rove --web` or `bun --filter rove-bridge dev`).
const bridge = process.env.ROVE_BRIDGE_URL ?? "ws://127.0.0.1:7878"

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: { proxy: { "/ws": { target: bridge, ws: true } } },
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
