import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_EDITION': JSON.stringify('main'),
  },
  test: {
    environment: 'node',
    include: ['src/edition.test.ts'],
  },
})
