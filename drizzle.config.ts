import { defineConfig } from 'drizzle-kit'

// Used only by `drizzle-kit generate` to emit SQL migrations from the schema.
// Migrations are applied to D1 with `wrangler d1 migrations apply` (see package.json),
// so no runtime database credentials are needed here.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/db/schema.ts',
  out: './migrations',
})
