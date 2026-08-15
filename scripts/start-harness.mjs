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

const args = [
  '--dir', harnessRoot,
  'dsh', 'web',
  '--patch', patchPath,
  ...process.argv.slice(2),
]
const pnpmCli = process.env.npm_execpath
if (pnpmCli !== undefined) {
  execFileSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' })
} else if (process.platform !== 'win32') {
  execFileSync('pnpm', args, { stdio: 'inherit' })
} else {
  throw new Error('Run this launcher through `pnpm host` on Windows.')
}
