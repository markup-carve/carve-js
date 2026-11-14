// CPU time of `format` (parse with the source-layout record, then write and parse each written
// group again) on the block and inline stress shapes of scripts/stress-tree.ts and
// scripts/stress-inline.ts, at three sizes ten times apart. A linear pass takes about ten times
// longer per step. It prints and fails only when a step takes more than `--limit` times the step
// before it (default 60, as for the tree: the last size leaves the caches that hold the one before).
//   node v2/scripts/stress-format.ts [--sizes 1000,10000,100000] [--limit N] [--only TEXT]
import { loadavg } from 'node:os'
import { format } from '../src/index.ts'
import { SHAPES } from './stress-inline.ts'
import { BLOCK_SHAPES, type Shape } from './stress-tree.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const sizes = option('sizes', '1000,10000,100000').split(',').map(Number)
const limit = Number(option('limit', '60'))
const only = option('only', '')

// Shapes whose written form takes escapes or another spelling, so the reparse runs more than one round.
const WRITER_SHAPES: readonly Shape[] = [
  ['escaped stars in one paragraph', (size) => '\\*a '.repeat(size)],
  ['escaped stars that pair in turn', (size) => `${'\\*a'.repeat(size)}*`],
  ['escaped openers in their own paragraphs', (size) => '\\# a\n\n\\- b\n\n'.repeat(size)],
  ['escaped markers on the lines of one paragraph', (size) => `a\n${'1\\. b\n'.repeat(size)}`],
  ['braced emphasis after a letter', (size) => 'a{/b/} '.repeat(size)],
  ['escaped pipes in the cells of one row', (size) => `|${' a\\|b |'.repeat(size)}`],
  ['rows with a continuation row', (size) => '| a | b |\n+ c | d |\n'.repeat(size)],
  ['numbered items', (size) => { let out = ''; for (let at = 1; at <= size; at++) out += `${at}. a\n`; return out }],
  ['quote fences', (size) => '::: >\na\n:::\n\n'.repeat(size)],
  ['tilde fences', (size) => '~~~\nx\n~~~\n\n'.repeat(size)],
  // Each backtick opens a code span, and each bracket takes the closer once the one beside it is
  // escaped, so these escapes reveal each other one at a time; the writer places them in one round.
  ['escaped backticks in one text', (size) => `x${'\\`'.repeat(size)}z`],
  ['escaped brackets before one link tail', (size) => `x${'\\['.repeat(size)}a](u)`],
  ['escaped brackets before one reference', (size) => `x${'\\['.repeat(size)}a][]`],
  ['escaped footnote openers before one closer', (size) => `x${'^\\['.repeat(size)}]`],
]

const INLINE_SHAPES: readonly Shape[] = SHAPES.map(([name, build]): Shape => [`inline: ${name}`, (size) => `x ${build(size)}`])

function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

/** CPU milliseconds of `action`: the lower of two runs. */
function time(action: () => void): number {
  let best = Infinity
  for (let run = 0; run < 2; run++) {
    const before = cpuMicros()
    action()
    best = Math.min(best, cpuMicros() - before)
  }
  return best / 1000
}

console.log(`Node ${process.version}, load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`)
console.log(`CPU milliseconds of format at the sizes ${sizes.join(', ')}; a step is the last size over the one before it`)
console.log('')
console.log(`| Shape | format ${sizes.join(' | format ')} | Step |`)
console.log(`|---|${sizes.map(() => '--:').join('|')}|--:|`)
let worst = 0
for (const [name, build] of [...BLOCK_SHAPES, ...WRITER_SHAPES, ...INLINE_SHAPES]) {
  if (!name.includes(only)) continue
  const times = sizes.map(build).map((src) => time(() => void format(src)))
  const step = times[times.length - 1]! / Math.max(times[times.length - 2]!, 0.5)
  worst = Math.max(worst, step)
  console.log(`| ${name.replaceAll('|', '\\|')} | ${times.map((ms) => ms.toFixed(1)).join(' | ')} | ${step.toFixed(1)} |`)
}
console.log('')
console.log(`Largest last step: ${worst.toFixed(1)} (a linear pass takes about 10)`)
process.exitCode = worst > limit ? 1 : 0
