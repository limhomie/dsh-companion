import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps/web/tests',
  fullyParallel: true,
  reporter: 'list',
  // Concurrent Chrome contexts intermittently abort service-worker navigations on Windows.
  workers: process.platform === 'win32' ? 1 : 6,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP companion.test 127.0.0.1',
        '--unsafely-treat-insecure-origin-as-secure=http://companion.test:4173',
        '--no-proxy-server',
      ],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-390',
      testIgnore: '**/native.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'mobile-430',
      testIgnore: '**/native.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'desktop',
      testIgnore: '**/native.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'android-shell',
      testMatch: '**/native.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4175',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @dsh-companion/web preview --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/companion/',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @dsh-companion/web preview --mode native --host 127.0.0.1 --port 4175',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
    },
  ],
})
