import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import * as clientConnection from '@deepseek-ai/dsh-client-connection'
import * as apiProxy from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-companion-host-web'
export const inject = ['webServer']

const COMPANION_PREFIX = '/companion'
export const EXPECTED_HARNESS_VERSION = '0.1.0-rc.5'

export const HARNESS_PACKAGES = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-host-webserver',
] as const

export type HarnessPackageName = (typeof HARNESS_PACKAGES)[number]

const REQUIRED_CAPABILITIES = [
  ['@deepseek-ai/dsh-client-connection', 'API_REMOTE_ACCESS'],
  ['@deepseek-ai/dsh-client-connection', 'ConnectionPrincipalId'],
  ['@deepseek-ai/dsh-host-apiproxy', 'OperationId'],
] as const

export interface HarnessCapabilityModules {
  readonly '@deepseek-ai/dsh-client-connection': Readonly<Record<string, unknown>>
  readonly '@deepseek-ai/dsh-host-apiproxy': Readonly<Record<string, unknown>>
}

/** Reject same-version builds that do not implement the public remote-authentication contract. */
export function assertHarnessCapabilities(modules: HarnessCapabilityModules): void {
  for (const [packageName, exportName] of REQUIRED_CAPABILITIES) {
    if (!(exportName in modules[packageName])) {
      throw new Error(
        `${name}: Harness ${EXPECTED_HARNESS_VERSION} lacks required public capability `
        + `${packageName}#${exportName}; no published official Harness release is compatible yet`,
      )
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionCompatibility: CompanionCompatibility
  }
}

/** Load barrier published only after all Host compatibility checks pass. */
export class CompanionCompatibility extends Service {
  constructor(ctx: Context) {
    super(ctx, 'companionCompatibility')
  }
}

/** Reject a partially upgraded Host before serving the Companion browser build. */
export function assertHarnessPackageVersions(
  versions: Readonly<Record<HarnessPackageName, unknown>>,
): void {
  for (const packageName of HARNESS_PACKAGES) {
    const version = versions[packageName]
    if (version !== EXPECTED_HARNESS_VERSION) {
      throw new Error(`${name}: ${packageName} must be ${EXPECTED_HARNESS_VERSION}; received ${String(version)}`)
    }
  }
}

export function readHarnessPackageVersions(): Record<HarnessPackageName, unknown> {
  const require = createRequire(import.meta.url)
  return Object.fromEntries(HARNESS_PACKAGES.map((packageName) => {
    try {
      const packageJson = require.resolve(`${packageName}/package.json`)
      const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown }
      return [packageName, manifest.version]
    } catch (error) {
      throw new Error(
        `${name}: required Harness capability package ${packageName} is unavailable; `
        + `this build requires the ${EXPECTED_HARNESS_VERSION} Companion migration baseline `
        + 'and no published official Harness release is compatible yet',
        { cause: error },
      )
    }
  })) as Record<HarnessPackageName, unknown>
}

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> {
  const body = await readFile(path)
  response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
  response.end(request.method === 'HEAD' ? undefined : body)
}

/**
 * Serve the Companion build without depending on a patched Harness static-file API.
 * Missing paths use the SPA index while traversal remains forbidden.
 */
export async function serveCompanionStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  distRoot: string,
  distIndex: string,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    response.writeHead(403)
    response.end()
    return
  }
  if (target === distRoot || target === distIndex) {
    await sendFile(request, response, distIndex)
    return
  }
  try {
    await sendFile(request, response, target)
  } catch {
    await sendFile(request, response, distIndex)
  }
}

/** Register the loopback-bound Companion SPA under the existing Harness server. */
export async function apply(ctx: Context): Promise<void> {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error(`${name}: refusing non-loopback webserver host ${ctx.webServer.host}`)
  }
  assertHarnessPackageVersions(readHarnessPackageVersions())
  assertHarnessCapabilities({
    '@deepseek-ai/dsh-client-connection': clientConnection,
    '@deepseek-ai/dsh-host-apiproxy': apiProxy,
  })
  new CompanionCompatibility(ctx)

  const distIndex = fileURLToPath(new URL('../web-dist/index.html', import.meta.url))
  const distRoot = dirname(distIndex)
  await access(distIndex)

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
      await serveCompanionStatic(request, response, relativePath, distRoot, distIndex)
    },
  }), `${name}: ${COMPANION_PREFIX} static route`)
}
