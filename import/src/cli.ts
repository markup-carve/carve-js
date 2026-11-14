#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { importDocument, type Format } from './index.ts'

function isFormat(value: string | undefined): value is Format {
  return value === 'markdown' || value === 'gfm' || value === 'djot' || value === 'html'
}
const parsed = parseArgs({ options: { from: { type: 'string' } }, allowPositionals: true })
const from = parsed.values.from
const file = parsed.positionals[0]
if (!isFormat(from) || file === undefined || parsed.positionals.length !== 1) {
  process.stderr.write('Usage: carve-import --from markdown|gfm|djot|html FILE\n')
  process.exitCode = 2
} else {
  const input = await readFile(file, 'utf8')
  const result = importDocument(input, { from })
  process.stdout.write(result.source)
  if (result.diagnostics.length) process.stderr.write(`${JSON.stringify(result.diagnostics, null, 2)}\n`)
}
