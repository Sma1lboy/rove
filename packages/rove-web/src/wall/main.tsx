import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/500.css"
import "@fontsource/jetbrains-mono/600.css"
import "@fontsource/jetbrains-mono/700.css"
import { createRoot } from "react-dom/client"
import "../tailwind.css"
import { Wall } from "./wall.tsx"

createRoot(document.getElementById("root") as HTMLElement).render(<Wall />)
