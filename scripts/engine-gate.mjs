#!/usr/bin/env node
// Bounds for both modes live here. The workflows only select the mode and gate.
import { spawnSync } from 'node:child_process'

const mode = process.argv[2]
const gate = process.argv[3]
if (!['full', 'smoke'].includes(mode)) throw new Error(`unknown mode: ${mode}`)
const smoke = mode === 'smoke'
const seed = 1794696020
const bounds = {
  full: { lines: 4, inline: 5, treeLines: 3, treeTokens: 4, mutants: 100000,
    fuzz: 20000, writerLines: 3, writerTokens: 4, writerContents: 50000, writerDocuments: 5000,
    stressSizes: '1000,10000,100000', inlineStressSizes: '1000,10000,100000', proptest: 100000000, importProptest: 100000000, scalingProptest: 100000000, minutes: 1, benchRounds: 20 },
  smoke: { lines: 2, inline: 2, treeLines: 2, treeTokens: 2, mutants: 1000,
    fuzz: 300, writerLines: 2, writerTokens: 2, writerContents: 200, writerDocuments: 50,
    stressSizes: '100,1000,10000', inlineStressSizes: '1000,10000,50000', proptest: 30, importProptest: 3, scalingProptest: 4, minutes: 0, benchRounds: 1 },
}[mode]

function run(command, args, cwd = '.') {
  console.log(`+ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const npm = (script, ...args) => run('npm', ['run', script, ...(args.length ? ['--', ...args] : [])])
const node = (file, ...args) => run('node', [file, ...args.map(String)])

switch (gate) {
  case 'extension-migration': npm('check:extension-migration'); break
  case 'ast-schema-crosscheck': {
    node('scripts/write-example-inputs.ts')
    // The pinned checker expects these compatibility paths until the spec pin advances.
    run('mkdir', ['-p', 'v2'])
    for (const path of ['src', 'data', 'test']) run('ln', ['-sfn', `../${path}`, `v2/${path}`])
    const result = spawnSync('node', ['--stack-size=8192', 'scripts/spec2-ast-crosscheck.mjs', '..'], {
      cwd: 'carve', stdio: 'inherit', env: { ...process.env, AST_FUZZ_COUNT: String(bounds.mutants) },
    })
    if (result.error) throw result.error
    node('scripts/check-ast-crosscheck.ts', '_AST_CROSSCHECK_FINDINGS.json.gz', bounds.mutants)
    break
  }
  case 'enumerate': npm('enumerate', String(bounds.lines)); break
  case 'enumerate-inline': npm('enumerate-inline', String(bounds.inline)); break
  case 'stress-inline':
    npm('stress-inline', '--sizes', bounds.inlineStressSizes, ...(smoke ? ['--limit', process.env.CARVE_ENGINE_SMOKE_STRESS_LIMIT ?? '15'] : []))
    if (!smoke) npm('test:stress')
    break
  case 'conformance':
    if (!smoke) { npm('test:lint'); npm('build') }
    npm('conformance', ...(smoke ? ['--sample', '20'] : []))
    if (!smoke) {
      run('npx', ['vitest', 'run', 'test/corpus.test.ts'])
      npm('differential-migrate'); npm('test:migrate')
    }
    break
  case 'enumerate-tree':
    npm('enumerate-tree', 'lines', String(bounds.treeLines))
    npm('enumerate-tree', 'tokens', String(bounds.treeTokens))
    break
  case 'fuzz-tree': npm('fuzz-tree', '--count', String(bounds.fuzz), '--seed', '1'); break
  case 'writer-gates':
    npm('writer-gates', 'examples')
    npm('writer-gates', 'lines', String(bounds.writerLines))
    npm('writer-gates', 'random', String(bounds.writerContents), String(bounds.writerDocuments), '1', '--silent')
    break
  case 'writer-gates-tokens': npm('writer-gates', 'tokens', String(bounds.writerTokens)); break
  case 'stress-tree':
    node('scripts/stress-tree.ts', '--sizes', bounds.stressSizes, ...(smoke ? ['--only', 'paragraphs'] : []))
    node('scripts/stress-format.ts', '--sizes', bounds.stressSizes, ...(smoke ? ['--only', 'escaped stars'] : []))
    break
  case 'benchmark':
    if (smoke) run('npx', ['tsc', '-p', 'upgrade/engine-0.1/tsconfig.json'])
    npm('bench', '--files', smoke ? 'test/fixtures/bench-commonmark-core.crv' : 'test/fixtures/bench-commonmark-core.crv,docs/api.md,docs/engine.md', '--rounds', String(bounds.benchRounds)); break
  case 'proptest':
    if (!smoke) npm('test:proptest')
    for (const target of ['parse', 'render', 'format', 'diagnostics', 'extensions', 'decode', 'cli', 'lint', 'migrate', 'import', 'scaling']) {
      if (smoke && target === 'cli') continue
      const count = target === 'import' ? bounds.importProptest : target === 'scaling' ? bounds.scalingProptest : bounds.proptest
      node('proptest/run.ts', '--target', target, '--seed', seed, '--count', count, '--minutes', bounds.minutes, '--max-bytes', 4096)
    }
    break
  default: throw new Error(`unknown gate: ${gate}`)
}
