// Prints the round-trip table: `node import/scripts/roundtrip.ts [--count N] [--seed N] [--max-bytes N] [--out FILE]`.
import { writeFileSync } from 'node:fs'
import { harnessInputs, measure, reportTable } from './roundtrip-harness.ts'

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(name)
  return at < 0 ? fallback : Number(process.argv[at + 1])
}

const count = option('--count', 20000)
const seed = option('--seed', 1794790227)
const maxBytes = option('--max-bytes', 2048)
const started = Date.now()
const inputs = harnessInputs(count, seed, maxBytes)
const lines = ['# HTML round trip', '',
  `Seed ${seed}, ${count} generated documents of at most ${maxBytes} bytes, and the specification examples. ` +
  'Each source is parsed, rendered with `roundtrip` on, imported from HTML and compared under C2-A-161 and C2-A-162.', '',
  ...reportTable('Specification examples', measure(inputs.examples)),
  ...reportTable('Generated documents', measure(inputs.generated)),
  `Seconds: ${((Date.now() - started) / 1000).toFixed(1)}.`, '']
const at = process.argv.indexOf('--out')
const out = at < 0 ? undefined : process.argv[at + 1]
if (out !== undefined) writeFileSync(out, lines.join('\n'))
process.stdout.write(`${lines.join('\n')}\n`)
