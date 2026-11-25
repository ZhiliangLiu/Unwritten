import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/log/schema.ts',
  out: './src/log/migrations',
});
