import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harnessRoot, projectRoot } from './verify-harness.mjs'

const tempRoot = resolve(projectRoot, '.tmp')
const patchPath = resolve(tempRoot, 'companion.patch.yml')
const pluginUrl = pathToFileURL(resolve(projectRoot, 'packages/host-web/src/index.ts')).href
mkdirSync(tempRoot, { recursive: true })
writeFileSync(patchPath, [
  '- insert:',
  '    - id: companion-web',
  `      name: ${JSON.stringify(pluginUrl)}`,
  '',
].join('\n'))

const forwardedArgs = process.argv.slice(2)
const configuredOrigin = process.env.DSH_COMPANION_PUBLIC_ORIGIN
if (configuredOrigin !== undefined) {
  const origin = new URL(configuredOrigin)
  if (origin.protocol !== 'https:' || origin.origin !== configuredOrigin) {
    throw new Error('DSH_COMPANION_PUBLIC_ORIGIN must be one canonical HTTPS origin')
  }
  forwardedArgs.push('--trusted-host', origin.host)
}

const args = [
  '--dir', harnessRoot,
  'dsh', 'web',
  '--patch', patchPath,
  ...forwardedArgs,
]
const pnpmCli = process.env.npm_execpath
if (pnpmCli !== undefined) {
  execFileSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' })
} else if (process.platform !== 'win32') {
  execFileSync('pnpm', args, { stdio: 'inherit' })
} else {
  throw new Error('Run this launcher through `pnpm host` on Windows.')
}
