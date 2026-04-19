import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ChatStandaloneApp } from "../ChatStandaloneApp.js"
import "../styles.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Missing #root host element")
}

createRoot(rootElement).render(
  <StrictMode>
    <ChatStandaloneApp />
  </StrictMode>,
)
