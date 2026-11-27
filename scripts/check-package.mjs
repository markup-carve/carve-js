import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { fromMarkdown } from 'mdast-util-from-markdown'

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
function packedReport(args) {
  const report = JSON.parse(execFileSync('npm', args, { cwd: root, encoding: 'utf8' }))
  // npm 10 reports a list of packages, npm 12 an object keyed by package name.
  return Array.isArray(report) ? report[0] : Object.values(report)[0]
}

function checkReadmeLinks() {
  const packed = packedReport(['pack', '--dry-run', '--json', '--ignore-scripts'])
  const files = new Set(packed.files.map((file) => file.path))
  const markdown = fromMarkdown(readFileSync(join(root, 'README.md'), 'utf8'))
  const definitions = new Map()
  const references = []
  const targets = []
  function visit(node) {
    if (node.type === 'definition') definitions.set(node.identifier, node.url)
    if (node.type === 'link' || node.type === 'image') targets.push(node.url)
    if (node.type === 'linkReference' || node.type === 'imageReference') references.push(node.identifier)
    for (const child of node.children ?? []) visit(child)
  }
  visit(markdown)
  for (const identifier of references) {
    const target = definitions.get(identifier)
    if (target !== undefined) targets.push(target)
  }
  const missing = new Set()
  for (const target of targets) {
    if (target.startsWith('#') || target.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(target)) continue
    const path = decodeURIComponent(new URL(target, 'https://package.invalid/README.md').pathname.slice(1))
    if (!files.has(path)) missing.add(path)
  }
  if (missing.size !== 0) throw new Error(`README links missing from npm package: ${[...missing].join(', ')}`)
  console.log(`All ${targets.length} README link targets resolve in the dry-run package or externally.`)
}
try {
  run('npm', ['run', 'build'])
  checkReadmeLinks()
  const packed = packedReport(['pack', '--json', '--ignore-scripts', '--pack-destination', consumer])
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
  console.log('Packed root, Node, import and extensions entry points and the carve bin passed the consumer check.')
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
