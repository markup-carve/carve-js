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
  writeFileSync(join(consumer, 'consumer.ts'), `
import { carveToHtml, fromAstJson, type Document } from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import * as prettier from '@markup-carve/carve/prettier'

const payload: unknown = { type: 'document', srcByteLength: 0, children: [] }
const doc: Document = fromAstJson(payload)
if (doc.children.length !== 0) throw new Error('Unexpected decoded children')
if (carveToHtml('hello').trim() !== '<p>hello</p>') throw new Error('Render failed')
if (typeof fileSystemResolver !== 'function') throw new Error('Missing Node export')
if (!prettier.parsers) throw new Error('Missing Prettier export')
`)
  copyFileSync(join(root, 'scripts/package-consumer-v2.ts'), join(consumer, 'consumer-v2.ts'))
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022',
      strict: true, exactOptionalPropertyTypes: true, types: [], outDir: 'out',
    },
    files: ['consumer.ts', 'consumer-v2.ts'],
  }))
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer)
  run(process.execPath, ['out/consumer.js'], consumer)
  run(process.execPath, ['out/consumer-v2.js'], consumer)
  // Hosts include browsers: the 0.2 entry bundles for the browser with no Node built-in.
  await build({
    stdin: { contents: "import { render } from '@markup-carve/carve/v2'\nglobalThis.out = render('a')\n", resolveDir: consumer },
    bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'error',
  })
  console.log('Packed ESM, Node, Prettier, 0.2 and 0.2 Node entry points passed the consumer check.')
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
