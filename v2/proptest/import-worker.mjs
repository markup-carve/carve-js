import { readFileSync } from 'node:fs'
import { importDocument, ImportInputError } from '../../import/src/index.ts'
const source = readFileSync(0, 'utf8')
try {
  const result = importDocument(source, { from: process.argv[2] })
  process.stdout.write(JSON.stringify({ kind: 'tree', document: result.document }))
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: error instanceof ImportInputError ? 'typed-error' : 'untyped-error',
    detail: String(error) }))
}
