import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const androidRoot = resolve(fileURLToPath(new URL('../apps/android/android/', import.meta.url)))

if (process.platform === 'win32') {
  execFileSync('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat assembleDebug'], {
    cwd: androidRoot,
    stdio: 'inherit',
  })
} else {
  execFileSync('./gradlew', ['assembleDebug'], {
    cwd: androidRoot,
    stdio: 'inherit',
  })
}

console.log('Debug APK: apps/android/android/app/build/outputs/apk/debug/app-debug.apk')
