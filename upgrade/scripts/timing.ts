// Time of one run of the tool on documents of 2k, 8k and 32k lines that hold every kind of
// rewrite, to show that the time grows with the size and not faster.
//   node upgrade/scripts/timing.ts
import { upgrade } from '../src/upgrade.ts'

const UNIT = [
  'Some _text_ with ~marks~ and =more= here',
  '# Heading',
  '',
  '- step one',
  '+',
  '> a note',
  '- step two',
  '',
  '| a | b |',
  '|---|--:|',
  '| 1 | 2 |',
  '',
  '> See [ref][].',
  '>',
  '> [ref]: https://example.com',
  '',
  '---',
  '',
  '= 4 is the answer',
  '',
].join('\n') + '\n'
const UNIT_LINES = 20

for (const size of [2000, 8000, 32000]) {
  const input = UNIT.repeat(size / UNIT_LINES)
  const started = performance.now()
  const result = upgrade(input)
  const elapsed = performance.now() - started
  console.log(`${size} lines: ${elapsed.toFixed(0)} ms, ${(elapsed / size * 1000).toFixed(1)} us per line, ${result.records.length} records, check ${result.check}`)
}
