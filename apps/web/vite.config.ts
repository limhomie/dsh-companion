import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const harnessSource = (path: string): string => resolve(import.meta.dirname, '../../../deepseek-harness', path)

export default defineConfig({
  base: '/companion/',
  plugins: [
    tsconfigPaths({ projects: [resolve(import.meta.dirname, '../../../deepseek-harness/tsconfig.base.json')] }),
    react(),
  ],
  build: {
    emptyOutDir: true,
    outDir: '../../packages/host-web/web-dist',
    sourcemap: true,
  },
  resolve: {
    alias: [
      { find: /^@deepseek-ai\/cordis$/, replacement: harnessSource('vendor/cordis/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-typert-registry\/client$/, replacement: harnessSource('packages/typert/registry/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-connection\/client$/, replacement: harnessSource('packages/client/connection/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-gateway\/client$/, replacement: harnessSource('packages/api/gateway/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-remotes\/client$/, replacement: harnessSource('packages/api/remotes/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-runtime\/client$/, replacement: harnessSource('packages/client/runtime/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-device-trust-connection$/, replacement: harnessSource('packages/identity/device-trust-connection/src/protocol.ts') },
    ],
  },
})
