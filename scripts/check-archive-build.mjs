// A git dependency (`npm install github:markup-carve/carve-js#<sha>`) is fetched as the GitHub source
// archive, which leaves out every `export-ignore` path of .gitattributes, and npm then runs `prepare`.
// This builds that same archive, so a build step reading an export-ignored path fails here first.
//   node scripts/check-archive-build.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archive = mkdtempSync(join(tmpdir(), 'carve-archive-build-'))
try {
  execFileSync('sh', ['-c', `git archive --format=tar HEAD | tar -x -C "${archive}"`], { cwd: root, stdio: 'inherit' })
  if (!existsSync(join(root, 'node_modules'))) throw new Error('Run `npm ci` first: the archive build reuses node_modules.')
  symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'), 'dir')
  execFileSync('npm', ['run', 'build'], { cwd: archive, stdio: 'inherit' })
  console.log('The git source archive builds, so a git dependency install can prepare it.')
} finally {
  rmSync(archive, { recursive: true, force: true })
}
