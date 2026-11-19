import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function isolatedConsumer() {
  const candidates = new Set([tmpdir(), ...(process.platform === 'win32' ? [] : ['/var/tmp'])])
  for (const base of candidates) {
    let isolated = true
    for (let parent = resolve(base); ; parent = dirname(parent)) {
      if (existsSync(join(parent, 'node_modules'))) {
        isolated = false
        break
      }
      if (dirname(parent) === parent) break
    }
    if (isolated) return mkdtempSync(join(base, 'carve-package-check-'))
  }
  throw new Error('Set TMPDIR to a directory with no ancestor node_modules for the consumer check.')
}

const consumer = isolatedConsumer()
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' })
try {
  run('npm', ['run', 'build'])
  const report = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', consumer,
  ], { cwd: root, encoding: 'utf8' }))
  // npm 10 reports a list of packages, npm 12 an object keyed by package name.
  const packed = Array.isArray(report) ? report[0] : Object.values(report)[0]
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    join(consumer, packed.filename),
  ], consumer)
  copyFileSync(join(root, 'scripts/package-consumer.ts'), join(consumer, 'consumer.ts'))
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022',
      strict: true, exactOptionalPropertyTypes: true, types: [], outDir: 'out',
    },
    files: ['consumer.ts'],
  }))
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer)
  run(process.execPath, ['out/consumer.js'], consumer)
  // Hosts include browsers: the root entry bundles for the browser with no Node built-in.
  await build({
    stdin: { contents: "import { render } from '@markup-carve/carve'\nglobalThis.out = render('a')\n", resolveDir: consumer },
    bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'error',
  })
  // The bin carries the 0.1 reader of `carve upgrade` inside its bundle.
  writeFileSync(join(consumer, 'legacy.crv'), '| a | b |\n|---|---|\n| 1 | 2 |\n')
  run(join(consumer, 'node_modules/.bin/carve'), ['--version'], consumer)
  run(join(consumer, 'node_modules/.bin/carve'), ['upgrade', '--write', 'legacy.crv'], consumer)
  run(join(consumer, 'node_modules/.bin/carve'), ['fmt', '--check', 'legacy.crv'], consumer)
  console.log('Packed root, Node and import entry points and the carve bin passed the consumer check.')
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
