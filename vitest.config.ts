import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-companion/device-trust': resolve(import.meta.dirname, 'packages/device-trust/src/index.ts'),
      '@dsh-companion/device-trust-connection/host': resolve(
        import.meta.dirname,
        'packages/device-trust-connection/src/index.ts',
      ),
      '@dsh-companion/device-trust-connection': resolve(
        import.meta.dirname,
        'packages/device-trust-connection/src/protocol.ts',
      ),
      '@dsh-companion/device-trust-local': resolve(
        import.meta.dirname,
        'packages/device-trust-local/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.spec.ts', 'packages/**/*.spec.tsx'],
    restoreMocks: true,
  },
})
