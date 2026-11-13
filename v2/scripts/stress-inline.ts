// CPU time of the inline pass on shapes that make a naive scan quadratic, at three sizes ten
// times apart. A linear pass takes about ten times longer per step. It prints and fails only
// when a step takes more than `--limit` times the step before it (default 30).
//   node v2/scripts/stress-inline.ts [--sizes 1000,10000,100000] [--limit N]
import { loadavg } from 'node:os'
import { acquireInlineState, scanInline } from '../src/index.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const sizes = option('sizes', '1000,10000,100000').split(',').map(Number)
const limit = Number(option('limit', '30'))

// [name, the content for a size]. A size is a count of openers, of nesting levels or of pairs;
// for the lines of one character it is a tenth of the length, so the last size is 1 MB.
const SHAPES: readonly (readonly [string, (size: number) => string])[] = [
  ...['*a ', '/a ', '{*', '{=a ', '[', '![', '^[', ':n[', '{%', '{#', '</#', '<a:', '<a@', '{k="', '{k=a', '{.a ', '[a](', '[a](x "', '[a]((', '[a][', '[^', '"', "'", '@', '#a ', ':a', '``a` ']
    .map((opener): [string, (size: number) => string] => [`unclosed ${opener.trim()}`, (size) => opener.repeat(size)]),
  ['nested brackets', (size) => `${'['.repeat(size)}x${']'.repeat(size)}`],
  ['nested links', (size) => `${'['.repeat(size)}x${'](/u)'.repeat(size)}`],
  ['nested spans', (size) => `${'['.repeat(size)}x${']{.c}'.repeat(size)}`],
  ['nested braced', (size) => `${'{^'.repeat(size)}x${'^}'.repeat(size)}`],
  ['nested bare', (size) => `${'*a '.repeat(size)}${'b* '.repeat(size)}`],
  ...['*', '/', '-', '`', '[', ']', '{', '}', '\\', '<', "'", '.', '=', '%', '_'].map((character): [string, (size: number) => string] => [`line of ${character}`, (size) => character.repeat(size * 10)]),
  ...['*a* ', '/a/ ', '{*a*} ', '[a] ', '[a](/u) ', '[a][b] ', '[a]{.c} ', '`a` ', '{%a%} ', '"a" ', '*a/ ', '{*a/} ', '/a *b/ c* ', '*{%a%} ', '{%a%}* ', '{*a*}{.c} ', 'a--b ', '<a:b> ', '</#a> ', '^[a] ', ':n[a] ', '![a](/u) ', '\\*a ']
    .map((pair): [string, (size: number) => string] => [`alternating ${pair.trim()}`, (size) => pair.repeat(size)]),
  ['closers only *}', (size) => '*} '.repeat(size)],
  ['closers only ]', (size) => '](/u) '.repeat(size)],
  ['spans that fail on a slash between words', (size) => `${'/a '.repeat(size)}*b c/d ${'e/ '.repeat(size)}`],
  ['tails in one destination run', (size) => `${'[a](x'.repeat(size)} "T`],
  ['tails at rising depth', (size) => `${'[a]((x'.repeat(size)} y`],
  ['attribute values that hold braces', (size) => `${'{a='.repeat(size)}`],
  ['labels with escapes', (size) => `${'[a][\\]'.repeat(size)}`],
  ['wrapped lines', (size) => Array.from({ length: size }, () => '*a').join('\n')],
]

function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

/** CPU milliseconds of one inline pass over `src`: the lower of two runs. */
function time(src: string): number {
  const state = acquireInlineState()
  const spans: number[] = []
  let start = 0
  for (let at = src.indexOf('\n'); at >= 0; at = src.indexOf('\n', start)) {
    spans.push(start, at)
    start = at + 1
  }
  spans.push(start, src.length)
  let best = Infinity
  for (let run = 0; run < 2; run++) {
    const before = cpuMicros()
    scanInline(state, src, spans, 0, spans.length, 0, true)
    best = Math.min(best, cpuMicros() - before)
  }
  return best / 1000
}

console.log(`Node ${process.version}, load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`)
console.log(`CPU milliseconds of one inline pass at the sizes ${sizes.join(', ')}; the last column is the last step`)
console.log('')
console.log(`| Shape | ${sizes.join(' | ')} | Step |`)
console.log(`|---|${sizes.map(() => '--:').join('|')}|--:|`)
let worst = 0
for (const [name, build] of SHAPES) {
  const times = sizes.map((size) => time(build(size)))
  const step = times[times.length - 1]! / Math.max(times[times.length - 2]!, 0.05)
  worst = Math.max(worst, step)
  console.log(`| ${name.replaceAll('|', '\\|')} | ${times.map((ms) => ms.toFixed(2)).join(' | ')} | ${step.toFixed(1)} |`)
}
console.log('')
console.log(`Largest last step: ${worst.toFixed(1)} (a linear pass takes about 10)`)
process.exitCode = worst > limit ? 1 : 0
