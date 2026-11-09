
import base from "./vite.config.ts"
import { writeFileSync } from "node:fs"
export default {
  ...base,
  plugins: [...base.plugins, {
    name: "graph-dump",
    generateBundle() {
      const out = {}
      for (const id of this.getModuleIds()) {
        const m = this.getModuleInfo(id)
        out[id] = { imp: m.importedIds, dyn: m.dynamicallyImportedIds, len: (m.code ?? "").length }
      }
      writeFileSync(process.env.GRAPH_OUT, JSON.stringify(out))
    },
  }],
}
