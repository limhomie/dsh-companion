import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { serveStatic } from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-companion-host-web'
export const inject = ['webServer']

const COMPANION_PREFIX = '/companion'
export const EXPECTED_HARNESS_VERSION = '0.1.0-rc.5'

const HARNESS_PACKAGES = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-device-trust-connection',
  '@deepseek-ai/dsh-host-frontend-static',
  '@deepseek-ai/dsh-host-webserver',
] as const

/** Reject a partially upgraded Host before serving the Companion browser build. */
export function assertHarnessPackageVersions(
  versions: Readonly<Record<(typeof HARNESS_PACKAGES)[number], unknown>>,
): void {
  for (const packageName of HARNESS_PACKAGES) {
    const version = versions[packageName]
    if (version !== EXPECTED_HARNESS_VERSION) {
      throw new Error(`${name}: ${packageName} must be ${EXPECTED_HARNESS_VERSION}; received ${String(version)}`)
    }
  }
}

function readHarnessPackageVersions(): Record<(typeof HARNESS_PACKAGES)[number], unknown> {
  const require = createRequire(import.meta.url)
  return Object.fromEntries(HARNESS_PACKAGES.map(packageName => {
    const packageJson = require.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown }
    return [packageName, manifest.version]
  })) as Record<(typeof HARNESS_PACKAGES)[number], unknown>
}

/** Register the loopback-bound Companion SPA under the existing Harness server. */
export async function apply(ctx: Context): Promise<void> {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error(`${name}: refusing non-loopback webserver host ${ctx.webServer.host}`)
  }
  assertHarnessPackageVersions(readHarnessPackageVersions())

  const distIndex = fileURLToPath(new URL('../web-dist/index.html', import.meta.url))
  const distRoot = dirname(distIndex)
  await access(distIndex)
  const renderIndex = async (): Promise<string> => await readFile(distIndex, 'utf8')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: COMPANION_PREFIX,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      const pathname = decodeURIComponent(new URL(request.url ?? COMPANION_PREFIX, 'http://x').pathname)
      const relativePath = pathname.slice(COMPANION_PREFIX.length) || '/'
      await serveStatic(relativePath, response, resolve(distRoot), distIndex, renderIndex)
    },
  }), `${name}: ${COMPANION_PREFIX} static route`)
}
