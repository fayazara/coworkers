import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import agents from "agents/vite"

const config = defineConfig({
  // `cf dev` does not forward flags like --port to Vite, so set them here.
  server: {
    host: process.env.HOST || "localhost",
    port: Number(process.env.PORT) || 3000,
    // Let the Worker answer CORS, as in production. Vite's own middleware
    // rejects the `null` origin of sandboxed bot apps (/apps/*).
    cors: false,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    devtools(),
    // TC39 decorator transform for `@callable()` on the agent classes.
    agents(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  environments: {
    // Worker source maps, uploaded by `cf deploy` for readable stack traces.
    ssr: {
      build: {
        sourcemap: true,
      },
    },
  },
})

export default config
