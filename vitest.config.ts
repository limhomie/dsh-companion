import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.spec.ts', 'packages/**/*.spec.tsx'],
    restoreMocks: true,
  },
})
