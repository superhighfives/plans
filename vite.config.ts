import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    // The Cloudflare plugin wires the Workers runtime + bindings into Vite.
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    // Resolve the `~/*` path alias from tsconfig.
    tsconfigPaths(),
    // MUST come before viteReact().
    tanstackStart(),
    viteReact(),
  ],
})
