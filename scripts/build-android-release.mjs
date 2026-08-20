import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const androidRoot = resolve(repositoryRoot, 'apps/android/android')
const androidPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'apps/android/package.json'), 'utf8'))
const requiredSigningVariables = [
  'DSH_ANDROID_KEYSTORE_FILE',
  'DSH_ANDROID_KEYSTORE_PASSWORD',
  'DSH_ANDROID_KEY_ALIAS',
  'DSH_ANDROID_KEY_PASSWORD',
]
const missingSigningVariables = requiredSigningVariables.filter(name => !process.env[name]?.trim())

if (missingSigningVariables.length > 0) {
  throw new Error(`Release signing is missing: ${missingSigningVariables.join(', ')}`)
}

if (process.platform === 'win32') {
  execFileSync('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat assembleRelease'], {
    cwd: androidRoot,
    stdio: 'inherit',
  })
} else {
  execFileSync('./gradlew', ['assembleRelease'], {
    cwd: androidRoot,
    stdio: 'inherit',
  })
}

const sourceApk = resolve(androidRoot, 'app/build/outputs/apk/release/app-release.apk')
const releaseDirectory = resolve(repositoryRoot, 'dist/releases', `android-v${androidPackage.version}`)
const releaseApk = resolve(releaseDirectory, `dsh-companion-${androidPackage.version}-universal.apk`)
const digest = createHash('sha256').update(readFileSync(sourceApk)).digest('hex').toUpperCase()

mkdirSync(releaseDirectory, { recursive: true })
copyFileSync(sourceApk, releaseApk)
writeFileSync(`${releaseApk}.sha256`, `${digest}  ${basename(releaseApk)}\n`, 'utf8')

console.log(`Release APK: ${releaseApk}`)
console.log(`SHA-256: ${digest}`)
