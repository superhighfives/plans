import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Resolve the `~/*` path alias from tsconfig (native as of Vite 6+;
  // replaces the vite-tsconfig-paths plugin).
  resolve: { tsconfigPaths: true },
  plugins: [
    // The Cloudflare plugin wires the Workers runtime + bindings into Vite.
    // `remoteBindings` lets bindings marked `remote: true` (the AI binding —
    // Workers AI has no local emulation) proxy to the real Cloudflare API in dev.
    cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: true }),
    // MUST come before viteReact().
    tanstackStart(),
    viteReact(),
  ],
})
