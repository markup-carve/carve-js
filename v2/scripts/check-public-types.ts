// Declaration emit for the 0.2 public entry with the installed compiler and TypeScript 5.9.
//   node v2/scripts/check-public-types.ts
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '../..')

function compiler(name: string): string {
  return join(dirname(require.resolve(`${name}/package.json`)), 'lib/tsc.js')
}

function check(name: string): void {
  const output = mkdtempSync(join(tmpdir(), 'carve-public-types-'))
  try {
    const args = [
      compiler(name), 'v2/src/index.ts', '--declaration', '--emitDeclarationOnly', '--outDir', output,
      '--strict', '--skipLibCheck', 'false', '--noEmitOnError', '--module', 'ESNext', '--moduleResolution', 'Bundler',
      '--target', 'ES2022', '--lib', 'ES2022', '--types', 'node', '--allowImportingTsExtensions',
      '--verbatimModuleSyntax', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess',
    ]
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
    if (result.stdout !== '') process.stdout.write(result.stdout)
    if (result.stderr !== '') process.stderr.write(result.stderr)
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`${name}: public declaration emit failed`)
    process.stdout.write(`${name}: public declaration emit passed\n`)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
}

check('typescript')
check('typescript-5-9')
