import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Standalone config so unit tests don't load the Cloudflare/TanStack Start
// Vite plugins (which expect the Workers runtime). Pure logic only here.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
