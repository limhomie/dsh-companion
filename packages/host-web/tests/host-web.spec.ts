// @vitest-environment node

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply,
  assertHarnessCapabilities,
  assertHarnessPackageVersions,
  EXPECTED_HARNESS_VERSION,
  serveCompanionStatic,
} from '../src/index.ts'
import { assertBundleConfigured } from '../../../scripts/manage-host-plugin.mjs'

const compatibleVersions = {
  '@deepseek-ai/dsh-client-connection': EXPECTED_HARNESS_VERSION,
  '@deepseek-ai/dsh-host-apiproxy': EXPECTED_HARNESS_VERSION,
  '@deepseek-ai/dsh-host-webserver': EXPECTED_HARNESS_VERSION,
} as const

describe('Companion Host compatibility', () => {
  it('recognizes only a complete standard web-profile assembly', () => {
    const configured = [
      "name: '@dsh-companion/host'",
      "name: '@dsh-companion/host/device-trust-local'",
      "name: '@dsh-companion/host/device-trust-connection'",
    ].join('\n')
    expect(() => { assertBundleConfigured(configured) }).not.toThrow()
    expect(() => { assertBundleConfigured("name: '@dsh-companion/host'") })
      .toThrow(/missing from the composed web profile/)
    expect(() => { assertBundleConfigured('', false) }).not.toThrow()
  })

  it('accepts only one complete Harness release', () => {
    expect(() => { assertHarnessPackageVersions(compatibleVersions) }).not.toThrow()
    expect(() => {
      assertHarnessPackageVersions({
        ...compatibleVersions,
        '@deepseek-ai/dsh-client-connection': '0.1.0-rc.8',
      })
    }).toThrow(/dsh-client-connection must be 0\.1\.0-rc\.5/)
  })

  it('reports a missing public authentication package version before serving the app', () => {
    expect(() => {
      assertHarnessPackageVersions({
        ...compatibleVersions,
        '@deepseek-ai/dsh-host-apiproxy': undefined,
      })
    }).toThrow(/dsh-host-apiproxy must be 0\.1\.0-rc\.5; received undefined/)
  })

  it('rejects an official same-version build without the remote principal contract', () => {
    expect(() => {
      assertHarnessCapabilities({
        '@deepseek-ai/dsh-client-connection': {},
        '@deepseek-ai/dsh-host-apiproxy': {},
      })
    }).toThrow(/lacks required public capability.*API_REMOTE_ACCESS/)
  })

  it('refuses to expose Companion from a non-loopback Host', async () => {
    const ctx = { webServer: { host: '0.0.0.0' } } as unknown as Context
    await expect(apply(ctx)).rejects.toThrow(/refusing non-loopback webserver host/)
  })
})

function capturedResponse(): {
  readonly response: ServerResponse
  readonly result: () => { status: number | undefined, headers: OutgoingHttpHeaders | undefined, body: Buffer }
} {
  let status: number | undefined
  let headers: OutgoingHttpHeaders | undefined
  let body = Buffer.alloc(0)
  const response = {
    writeHead(nextStatus: number, nextHeaders?: OutgoingHttpHeaders) {
      status = nextStatus
      headers = nextHeaders
      return this
    },
    end(chunk?: string | Uint8Array) {
      body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk)
      return this
    },
  } as unknown as ServerResponse
  return { response, result: () => ({ status, headers, body }) }
}

describe('Companion Host static route', () => {
  it('serves PWA images with their MIME type and rejects traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-companion-host-'))
    try {
      const index = join(root, 'index.html')
      const icon = join(root, 'icon.png')
      await writeFile(index, '<main>Companion</main>')
      await writeFile(icon, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

      const image = capturedResponse()
      await serveCompanionStatic(
        { method: 'GET' } as IncomingMessage,
        image.response,
        '/icon.png',
        root,
        index,
      )
      expect(image.result()).toMatchObject({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      })

      const traversal = capturedResponse()
      await serveCompanionStatic(
        { method: 'GET' } as IncomingMessage,
        traversal.response,
        '/../outside.txt',
        root,
        index,
      )
      expect(traversal.result()).toMatchObject({ status: 403, body: Buffer.alloc(0) })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
