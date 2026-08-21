import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import tsconfigPaths from 'vite-tsconfig-paths'

const harnessSource = (path: string): string => resolve(import.meta.dirname, '../../../deepseek-harness', path)

export default defineConfig(({ mode }): UserConfig => {
  const native = mode === 'native'
  return {
    base: native ? './' : '/companion/',
    plugins: [
      tsconfigPaths({ projects: [resolve(import.meta.dirname, '../../../deepseek-harness/tsconfig.base.json')] }),
      react(),
      VitePWA({
        disable: native,
        injectRegister: 'script-defer',
        manifest: {
          id: '/companion/',
          name: 'DSH Companion',
          short_name: 'DSH Companion',
          description: 'DeepSeek Harness 的移动端伴侣客户端',
          lang: 'zh-CN',
          start_url: '/companion/',
          scope: '/',
          display: 'standalone',
          related_applications: [
            { platform: 'webapp', url: '/companion/manifest.webmanifest', id: '/companion/' },
          ],
          background_color: '#f5f6f4',
          theme_color: '#f5f6f4',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        registerType: 'autoUpdate',
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{css,html,ico,js,png,svg,webmanifest}'],
          navigateFallback: '/companion/index.html',
          navigateFallbackAllowlist: [/^\/companion(?:\/|$)/],
        },
      }),
    ],
    build: {
      emptyOutDir: true,
      outDir: native ? '../android/www' : '../../packages/host-web/web-dist',
      sourcemap: native,
    },
    preview: {
      allowedHosts: ['companion.test'],
    },
    resolve: {
      alias: [
        { find: /^@deepseek-ai\/cordis$/, replacement: harnessSource('vendor/cordis/src/index.ts') },
        { find: /^@deepseek-ai\/dsh-typert-registry\/client$/, replacement: harnessSource('packages/typert/registry/src/client/index.ts') },
        { find: /^@deepseek-ai\/dsh-client-connection\/client$/, replacement: harnessSource('packages/client/connection/src/client/index.ts') },
        { find: /^@deepseek-ai\/dsh-api-gateway\/client$/, replacement: harnessSource('packages/api/gateway/src/client/index.ts') },
        { find: /^@deepseek-ai\/dsh-api-remotes\/client$/, replacement: harnessSource('packages/api/remotes/src/client/index.ts') },
        { find: /^@deepseek-ai\/dsh-client-runtime\/client$/, replacement: harnessSource('packages/client/runtime/src/client/index.ts') },
      ],
    },
  }
})
