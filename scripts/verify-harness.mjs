import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_COMMIT = '2a8d995b4b43a4f308143a40ed1fcf9e633aac47'
const EXPECTED_VERSION = '0.1.0-rc.5'
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const harnessRoot = resolve(projectRoot, '../deepseek-harness')

function fail(message) {
  throw new Error(`Harness checkout verification failed: ${message}`)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(resolve(harnessRoot, 'package.json'), 'utf8'))
} catch (error) {
  fail(`expected a sibling checkout at ${harnessRoot} (${error instanceof Error ? error.message : String(error)})`)
}

if (manifest.version !== EXPECTED_VERSION) {
  fail(`expected version ${EXPECTED_VERSION}, received ${String(manifest.version)}`)
}

const commit = execFileSync('git', ['-C', harnessRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== EXPECTED_COMMIT) fail(`expected commit ${EXPECTED_COMMIT}, received ${commit}`)

export { EXPECTED_COMMIT, EXPECTED_VERSION, harnessRoot, projectRoot }
