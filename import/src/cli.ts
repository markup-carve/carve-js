#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { ImportInputError, importDocument, type Format } from './index.ts'

function isFormat(value: string | undefined): value is Format {
  return value === 'markdown' || value === 'gfm' || value === 'djot' || value === 'html'
}
async function readInput(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8') } catch (error) {
    process.stderr.write(`carve[input-unreadable]: ${file}: ${String(error)}\n`)
    process.exitCode = 2
    return undefined
  }
}

const parsed = parseArgs({ options: { from: { type: 'string' } }, allowPositionals: true })
const from = parsed.values.from
const file = parsed.positionals[0]
if (!isFormat(from) || file === undefined || parsed.positionals.length !== 1) {
  process.stderr.write('Usage: carve-import --from markdown|gfm|djot|html FILE\n')
  process.exitCode = 2
} else {
  const input = await readInput(file)
  if (input !== undefined) {
    try {
      const result = importDocument(input, { from })
      process.stdout.write(result.source)
      if (result.diagnostics.length) process.stderr.write(`${JSON.stringify(result.diagnostics, null, 2)}\n`)
    } catch (error) {
      if (!(error instanceof ImportInputError)) throw error
      process.stderr.write(`carve[import-input-invalid]: ${file}: ${error.message}\n`)
      process.exitCode = 2
    }
  }
}
