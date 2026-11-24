// Size families for the `scaling` target: a family maps a size n to a source whose nesting depth or width grows
// with n. The check times each operation at n, 2n, 4n and 8n and flags growth past n log n, a stack overflow, or
// an untyped exception. Depths run from 50 to 5,000, past every engine depth cap (MAX_DEPTH, DEPTH_CAP), so the
// capped path is measured too.
import { CarveInputError, formatWithDiagnostics, lint, parse, render } from '../src/index.ts'
import { type Random } from './generate.ts'
// A type import only: check.ts reads data files relative to the working directory when it loads.
import type { Finding } from './check.ts'

export interface Family { name: string, build: (n: number) => string }

const WORDS = ['a', 'b c', '*', '_', '`', '[', ']', '(', ')', '{', '}', '<', '>', '"', '\\', '$', '^', '~', '=',
  '+', '-', '#', '|', ':', '!', '@', '&', ';', 'x\ny', '\n', '\n\n', '\t', ' ', '1.', '[^n]', '{.c}', '{#i}']

function word(rng: Random): string { return WORDS[rng.int(WORDS.length)] ?? 'a' }
function words(rng: Random, count: number): string { return Array.from({ length: count }, () => word(rng)).join('') }

const BLOCK_PREFIXES = ['> ', '- ', '* ', '+ ', '1. ', '1) ', ': ', '>', '-\t', '| ', '  ', '\t']
const INLINE_PAIRS: [string, string][] = [['*', '*'], ['_', '_'], ['[', '](u)'], ['[', ']{.c}'], ['{', '}'],
  ['(', ')'], ['<', '>'], ['"', '"'], ['^', '^'], ['~', '~'], ['=', '='], ['+', '+'], ['{=', '=}'], ['{+', '+}'],
  ['{-', '-}'], ['[^', ']'], ['![', '](i.png)'], ['`', '`'], ['$`', '`'], ['[[', ']]'], ['{~', '~}'], ['**', '**']]
const REPEATS = ['*a ', '_a ', '[a ', 'a] ', '![', '](', '{', '}', '{.c} ', '`', '<a ', 'http://a.b ', '[^x] ',
  '\\', '&amp;', '"a ', "'a ", ':::\n', '```\n', '# h\n', '| a | b |\n', '[x]: /u\n', '[^x]: n\n', '- a\n',
  '> a\n', 'a  \n', '- [ ] a\n', '{#i}\n# h\n', '***\n', '{=a\n', '[a]{.c}', '*[a](u)*', '$$x$$ ']

function block(rng: Random): Family {
  const prefixes = Array.from({ length: 1 + rng.int(3) }, () => BLOCK_PREFIXES[rng.int(BLOCK_PREFIXES.length)] ?? '> ')
  const body = words(rng, rng.int(6)) || 'a'
  const lines = 1 + rng.int(3)
  return {
    name: `block ${JSON.stringify(prefixes)} ${JSON.stringify(body)} x${lines}`,
    build: (n) => {
      const prefix = Array.from({ length: n }, (_, at) => prefixes[at % prefixes.length]).join('')
      return Array.from({ length: lines }, () => prefix + body).join('\n') + '\n'
    },
  }
}

function indented(rng: Random): Family {
  const marker = ['- ', '1. ', '* ', '> ', ': '][rng.int(5)] ?? '- '
  const body = words(rng, rng.int(4)) || 'a'
  return {
    name: `staircase ${JSON.stringify(marker)} ${JSON.stringify(body)}`,
    build: (n) => Array.from({ length: n }, (_, at) => ' '.repeat(at * marker.length) + marker + body).join('\n') + '\n',
  }
}

function fenced(rng: Random): Family {
  const fence = [':::', '```', '~~~', '::: c'][rng.int(4)] ?? ':::'
  const body = words(rng, rng.int(4)) || 'a'
  const closed = rng.bool()
  return {
    name: `fences ${JSON.stringify(fence)} ${JSON.stringify(body)} closed=${closed}`,
    build: (n) => {
      const open = Array.from({ length: n }, (_, at) => fence[0]!.repeat(3 + n - at) + fence.slice(3))
      const close = Array.from({ length: n }, (_, at) => fence[0]!.repeat(4 + at))
      return [...open, body, ...(closed ? close : [])].join('\n') + '\n'
    },
  }
}

function inline(rng: Random): Family {
  const pairs = Array.from({ length: 1 + rng.int(3) }, () => INLINE_PAIRS[rng.int(INLINE_PAIRS.length)] ?? ['*', '*'])
  const filler = rng.bool() ? '' : words(rng, 1 + rng.int(2))
  const closed = rng.int(3)
  return {
    name: `inline ${JSON.stringify(pairs)} ${JSON.stringify(filler)} closed=${closed}`,
    build: (n) => {
      let open = ''
      let close = ''
      for (let at = 0; at < n; at++) {
        const [left, right] = pairs[at % pairs.length]!
        open += left + filler
        close = right + close
      }
      const end = closed === 0 ? '' : closed === 1 ? close : close.slice(0, close.length >> 1)
      return 'a ' + open + 'x' + end + '\n'
    },
  }
}

function repeat(rng: Random): Family {
  const parts = Array.from({ length: 1 + rng.int(3) }, () => REPEATS[rng.int(REPEATS.length)] ?? '*a ')
  const tail = rng.bool() ? '' : words(rng, 1 + rng.int(3))
  return {
    name: `repeat ${JSON.stringify(parts)} ${JSON.stringify(tail)}`,
    build: (n) => Array.from({ length: n }, (_, at) => parts[at % parts.length]).join('') + tail + '\n',
  }
}

function prefixed(rng: Random): Family {
  const inner = repeat(rng)
  const prefix = BLOCK_PREFIXES[rng.int(BLOCK_PREFIXES.length)] ?? '> '
  const depth = 1 + rng.int(4)
  return {
    name: `prefixed ${JSON.stringify(prefix)}x${depth} ${inner.name}`,
    build: (n) => inner.build(n).split('\n').map((line) => prefix.repeat(depth) + line).join('\n'),
  }
}

/**
 * A source of `chosen` at a size up to `wanted` that stays near `maxBytes`: sizes double from 50 while they fit,
 * and the result lies between the last fitting size and the next doubling, so it costs at most four times the
 * budget even for a family that grows quadratically.
 */
export function fitted(chosen: Family, wanted: number, maxBytes: number, rng: Random): string {
  let size = Math.min(50, wanted)
  while (size * 2 <= wanted && chosen.build(size * 2).length <= maxBytes) size *= 2
  const upper = Math.min(wanted, size * 2 - 1)
  return chosen.build(size + rng.int(upper - size + 1))
}

export function family(rng: Random): Family {
  switch (rng.int(6)) {
    case 0: return block(rng)
    case 1: return indented(rng)
    case 2: return fenced(rng)
    case 3: return inline(rng)
    case 4: return repeat(rng)
    default: return prefixed(rng)
  }
}

export type Operation = [string, (source: string) => unknown]
const OPERATIONS: Operation[] = [
  ['parse', (source) => parse(source)],
  ['render', (source) => render(source)],
  ['format', (source) => formatWithDiagnostics(source)],
  ['lint', (source) => lint(source)],
]

function cpuMs(): number {
  const usage = process.cpuUsage()
  return (usage.user + usage.system) / 1000
}

// A single call on a small input takes well under a millisecond, below the resolution of the CPU clock on CI
// runners, so one timing of it read as a fraction of its real cost and a linear curve looked superlinear.
const RUN_MS = 10

/**
 * The best of `runs` per-call timings, each repeating `work` until the run lasts `RUN_MS`; the minimum filters
 * scheduler noise on a loaded machine.
 */
function best(work: () => unknown, runs: number): number {
  let low = Infinity
  for (let at = 0; at < runs; at++) {
    const start = cpuMs()
    let calls = 0
    let elapsed = 0
    do {
      work()
      calls++
      elapsed = cpuMs() - start
    } while (elapsed < RUN_MS)
    low = Math.min(low, elapsed / calls)
  }
  return low
}

// Growth is judged per byte: some families grow quadratically in bytes with n (a staircase indents every line one
// step further), and an engine linear in bytes is linear there. A time ratio more than twice the byte ratio, that a
// second measurement repeats, at a time large enough to measure, is superlinear. The slack is not scaled down when
// the byte budget stops a family after one or two doublings: such a family quadruples its bytes per doubling and
// changes its mix past the depth caps (nested fences turn into paragraph text past MAX_DEPTH), so a linear engine
// moves its cost per byte by more than a scaled slack allows, while a quadratic one still exceeds twice the ratio.
const SLACK = 2
const FLOOR_MS = 8
const STEP_BUDGET_MS = 4000
const DEEP_MAX_BYTES = 2 * 1024 * 1024

/** A family quadratic in bytes would build a string far past the budget only to drop it. */
function nextPastBudget(sizes: number[]): boolean {
  const [before, last] = sizes.slice(-2)
  return before !== undefined && last !== undefined && last * last / before > 2 * DEEP_MAX_BYTES
}

function measure(operation: Operation, build: (n: number) => string, base: number): string | null {
  const times: number[] = []
  const sizes: number[] = []
  for (const factor of [1, 2, 4, 8]) {
    if (nextPastBudget(sizes)) break
    const source = build(base * factor)
    if (source.length > DEEP_MAX_BYTES && times.length >= 2) break
    const ms = best(() => operation[1](source), factor === 8 ? 2 : 3)
    times.push(ms)
    sizes.push(source.length)
    if (ms > STEP_BUDGET_MS) break
  }
  const doublings = times.length - 1
  const last = times[doublings] ?? 0
  if (doublings < 1 || last < FLOOR_MS) return null
  const sizeRatio = (sizes[doublings] ?? 1) / Math.max(1, sizes[0] ?? 1)
  const first = Math.max(times[0] ?? 0, 0.5)
  if (last / first <= sizeRatio * SLACK) return null
  return `${operation[0]} n=${base}: ${times.map((ms) => ms.toFixed(1)).join(', ')} ms at ` +
    `${sizes.join(', ')} chars`
}

/**
 * A cost per byte that rises at small sizes and then stays flat (cache sizes, a depth cap) repeats at the same sizes;
 * a superlinear cost keeps its ratio at four times the base. The larger base shrinks to two times or the same base
 * when the bytes of its second step would pass the budget, which `measure` takes regardless.
 */
export function superlinear(operation: Operation, build: (n: number) => string, base: number): string | null {
  if (measure(operation, build, base) === null) return null
  const two = build(base * 2).length
  const step = two / Math.max(1, build(base).length)
  let factor = 4
  while (factor > 1 && two * step ** Math.log2(factor) > DEEP_MAX_BYTES) factor >>= 1
  return measure(operation, build, base * factor)
}

function failure(error: unknown): Finding | null {
  if (error instanceof CarveInputError) return null
  if (error instanceof RangeError && /call stack/i.test(error.message)) {
    return { kind: 'scaling-stack-overflow', detail: String(error.stack ?? error) }
  }
  return { kind: 'scaling-exception', detail: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error) }
}

/**
 * The source is a seed only: it picks the family and the base size, so the runner's minimizer has nothing to
 * shrink and the finding detail names the family instead.
 */
export function checkScaling(_source: string, rng: Random): Finding | null {
  const chosen = family(rng)
  const base = 50 + rng.int(576)
  const operation = OPERATIONS[rng.int(OPERATIONS.length)]!
  let depth = Math.min(5000, base * 8)
  let deep = chosen.build(depth)
  // Families that grow quadratically in bytes reach 24 MB at depth 5,000, which the writer cannot finish in the
  // case timeout; 2 MB still nests far past every depth cap.
  while (deep.length > DEEP_MAX_BYTES && depth > 50) deep = chosen.build(depth = Math.max(50, depth >> 1))
  try { operation[1](deep) } catch (error) {
    const found = failure(error)
    if (found !== null) return { ...found, detail: `${operation[0]} ${chosen.name} n=${depth}\n${found.detail}` }
  }
  try {
    const again = superlinear(operation, chosen.build, Math.min(base, 625))
    return again === null ? null : { kind: `scaling-superlinear-${operation[0]}`, detail: `${chosen.name}\n${again}` }
  } catch (error) {
    const found = failure(error)
    return found === null ? null : { ...found, detail: `${operation[0]} ${chosen.name}\n${found.detail}` }
  }
}
