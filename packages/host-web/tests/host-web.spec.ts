// @vitest-environment node

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply,
  assertHarnessPackageVersions,
  EXPECTED_HARNESS_VERSION,
} from '../src/index.ts'

const compatibleVersions = {
  '@deepseek-ai/dsh-client-connection': EXPECTED_HARNESS_VERSION,
  '@deepseek-ai/dsh-device-trust-connection': EXPECTED_HARNESS_VERSION,
  '@deepseek-ai/dsh-host-frontend-static': EXPECTED_HARNESS_VERSION,
  '@deepseek-ai/dsh-host-webserver': EXPECTED_HARNESS_VERSION,
} as const

describe('Companion Host compatibility', () => {
  it('accepts only one complete Harness release', () => {
    expect(() => { assertHarnessPackageVersions(compatibleVersions) }).not.toThrow()
    expect(() => {
      assertHarnessPackageVersions({
        ...compatibleVersions,
        '@deepseek-ai/dsh-client-connection': '0.1.0-rc.6',
      })
    }).toThrow(/dsh-client-connection must be 0\.1\.0-rc\.5/)
  })

  it('refuses to expose Companion from a non-loopback Host', async () => {
    const ctx = { webServer: { host: '0.0.0.0' } } as unknown as Context
    await expect(apply(ctx)).rejects.toThrow(/refusing non-loopback webserver host/)
  })
})
