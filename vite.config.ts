import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export function buildShellViteConfig(command: "serve" | "build") {
  return {
    root: resolve(__dirname, "src/shell/web"),
    base: command === "build" ? "./" : "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    build: {
      outDir: resolve(__dirname, "dist/web"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: resolve(__dirname, "src/shell/web/index.html"),
          chat: resolve(__dirname, "src/shell/web/chat/index.html"),
        },
      },
    },
  }
}

export default defineConfig(({ command }) =>
  buildShellViteConfig(command === "build" ? "build" : "serve"),
)
