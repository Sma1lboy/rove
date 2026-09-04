/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { configDefaults } from "vitest/config"

// The PTY terminal lives in a separate node process (node-pty doesn't work
// under bun). Proxy its WebSocket here so the browser stays single-origin.
const ptyPort = process.env.KOBE_PTY_PORT ?? "5175"

const config = defineConfig({
  // Dedupe React to ONE copy. The monorepo has two React versions on disk
  // (kobe-web pins ^19.2, branding pins 19.0), and any dependency with a
  // loose `react >=16.8` peer can resolve the other one — which puts hooks
  // on a second React dispatcher ("Invalid hook call" in dev) and ships both
  // runtimes in the bundle.
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  server: {
    proxy: {
      "/pty": {
        target: `ws://localhost:${ptyPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    viteReact(),
  ],
  // `e2e/` is Playwright's (bun run test:e2e) — vitest's default glob would
  // otherwise collect those specs and fail on the foreign test() runner.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
})

export default config
