import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const androidRoot = resolve(fileURLToPath(new URL('../apps/android/android/', import.meta.url)))
const textExtensions = new Set(['.bat', '.gradle', '.java', '.md', '.pro', '.properties', '.xml'])
const textNames = new Set(['.gitignore', 'gradlew'])
const skippedDirectories = new Set(['.gradle', 'build'])

async function normalizeDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) await normalizeDirectory(path)
      continue
    }
    if (!textNames.has(entry.name) && !textExtensions.has(extname(entry.name))) continue
    const source = await readFile(path, 'utf8')
    const normalized = `${source.replace(/\r\n?/g, '\n').replace(/\n+$/u, '')}\n`
    if (normalized !== source) await writeFile(path, normalized, 'utf8')
  }
}

await normalizeDirectory(androidRoot)
