import { defineConfig } from 'vitest/config'

// Standalone config so unit tests don't load the Cloudflare/TanStack Start
// Vite plugins (which expect the Workers runtime). Pure logic only here.
export default defineConfig({
  // Resolve the `~/*` path alias from tsconfig (native as of Vite 6+;
  // replaces the vite-tsconfig-paths plugin).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
