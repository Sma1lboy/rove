import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `bun run dev:ui` gives HMR; /api and /v go to `wrangler dev` on 8787 (`bun run dev` in another shell).
const worker = "http://127.0.0.1:8787"

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: { proxy: { "/api": worker, "/v": worker } },
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
})
