import base from "./vite.config.ts"

// The iPhone app's demo: the client on canned answers, loaded from the app bundle (rove-ios/scripts/build-demo-web.sh).
// Relative asset paths, and none of the bridge's own files (service worker, PWA manifest, icons).
export default {
  ...base,
  base: "./",
  publicDir: false,
  build: { outDir: "dist-demo", emptyOutDir: true, rollupOptions: { input: "demo.html" } },
}
