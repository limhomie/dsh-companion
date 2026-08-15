import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-device-trust-connection': resolve(
        import.meta.dirname,
        '../deepseek-harness/packages/identity/device-trust-connection/src/protocol.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.spec.ts', 'packages/**/*.spec.tsx'],
    restoreMocks: true,
  },
})
