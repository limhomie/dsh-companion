import { execFileSync } from 'node:child_process'
import { accessSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessRoot, projectRoot, verifyHarnessCheckout } from './verify-harness.mjs'

export const BUNDLE_NAME = '@dsh-companion/host'
export const bundleRoot = resolve(projectRoot, 'packages/host-web')

function runPnpm(args, capture = false) {
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli === undefined) {
    throw new Error('Run Host bundle management through a pnpm script.')
  }
  return execFileSync(process.execPath, [pnpmCli, ...args], {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}
function dsh(args, capture = false) {
  return runPnpm(['--dir', harnessRoot, 'dsh', ...args], capture)
}

export function assertBundleConfigured(config, expected = true) {
  const markers = [
    "name: '@dsh-companion/host'",
    "name: '@dsh-companion/host/device-trust-local'",
    "name: '@dsh-companion/host/device-trust-connection'",
  ]
  const present = markers.every(marker => config.includes(marker))
  if (present !== expected) {
    throw new Error(expected
      ? 'Companion Host bundle is installed but missing from the composed web profile.'
      : 'Companion Host bundle still appears in the composed web profile after uninstall.')
  }
}

function dumpAndAssert(expected) {
  const config = dsh(['--profile', 'web', '--dump-config'], true)
  assertBundleConfigured(config, expected)
}

export function installHostBundle() {
  verifyHarnessCheckout()
  accessSync(resolve(bundleRoot, 'lib/index.js'))
  accessSync(resolve(bundleRoot, 'web-dist/index.html'))
  dsh(['plugin', '--profile', 'web', 'add', `link:${bundleRoot}`])
  dumpAndAssert(true)
}

export function verifyHostBundle() {
  verifyHarnessCheckout()
  dumpAndAssert(true)
}

export function uninstallHostBundle() {
  dsh(['plugin', '--profile', 'web', 'remove', BUNDLE_NAME])
  dumpAndAssert(false)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2]
  if (action === 'install') installHostBundle()
  else if (action === 'verify') verifyHostBundle()
  else if (action === 'uninstall') uninstallHostBundle()
  else throw new Error('Usage: manage-host-plugin.mjs <install|verify|uninstall>')
}
