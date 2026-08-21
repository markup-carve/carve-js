import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * No test in the everyday suite may assert a measured wall-clock duration
 * against an absolute number.
 *
 * carve-js#1268 was one such assertion going red on unchanged `main` - 2651ms
 * against a 2500ms bound, purely because the box was at loadavg 36 rising to 50
 * on 16 cores. The cost of that is not the one failing test. A red default
 * branch is the signal that says "this is broken for a reason your ticket does
 * not describe", i.e. the cue to stop and investigate rather than build; a test
 * that emits it from ambient load teaches everyone to read past it, and that is
 * the one reading in the suite that has to stay trustworthy.
 *
 * IT WAS NOT ALONE, which is why this guard exists rather than just a fix. Nine
 * absolute-time assertions were running in the concurrent everyday suite - and
 * run over copies of the five pre-fix files, this scanner reports exactly those
 * nine, which is what makes its silence on the fixed tree mean something. They
 * were spread across `djot-migrate` (2), `markdown-deep-list-perf` (4), `lint`,
 * `abbr-amplification` and `merge-properties`, and
 * the headroom on the tightest three - 5.4x, 5.8x, 6.0x - was less than the
 * 10.4x inflation ambient load was measured producing on unchanged code. Two of
 * them were then seen to fail for that reason alone: the 2500ms bound at loadavg
 * 36, and `merge-properties` reading 3138ms against the same bound at 58. One of
 * them could not have caught its own defect at all: disabling the abbreviation
 * budget made every target emit ~50MB, and the render still finished inside
 * 400ms, well under the 2000ms that assertion allowed.
 *
 * WHAT IS STILL ALLOWED, because none of these forms reads the machine:
 *
 * - counted work - steps, cells, allocations, bytes, node count
 * - a RATIO of two durations measured in the same run, which cancels load
 *   (`expect(large / small).toBeLessThan(2)`); `test/helpers/scaling.ts` is the
 *   shared implementation, and this guard deliberately does not flag it
 * - a wall-clock bound inside a `perfIt` block, which runs only under
 *   `npm run test:perf` - serial, on a CI runner of its own
 *
 * Whichever form a new guard takes, state what it read and under what
 * conditions. A stopwatch number with no stated conditions is not a
 * measurement.
 *
 * ONE BLIND SPOT, stated rather than left to be discovered: the scan reads
 * `it`/`test`/`perfIt` blocks in `*.test.ts`, so an absolute bound asserted
 * inside a shared helper is invisible to it. `test/helpers/scaling.ts` holds
 * exactly one - its `MAX_MS = 20_000` catastrophic backstop - and that is
 * deliberate: every caller of that helper is a `perfIt`, so it never runs in the
 * everyday suite. A NEW helper that asserts a duration for ungated callers
 * would slip past this guard, and the check for that is review, not the scan.
 */

// `fileURLToPath`, not `.pathname`: a URL keeps a space as `%20` and a checkout
// path is not guaranteed to be free of those, which would make `readdirSync`
// throw on a directory that exists - a guard that fails for a reason unrelated
// to what it guards.
const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Every `.test.ts` under `test/`, recursively. */
function testFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...testFiles(path))
    else if (entry.endsWith('.test.ts')) out.push(path)
  }

  return out.sort()
}

/** Read from `source[open]`, which must be `(`, to its matching `)`. */
function matchParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    // Template literals and strings can hold unbalanced parens; skip them.
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/** Split an argument list on its TOP-LEVEL commas. */
function topLevelArgs(inner: string): string[] {
  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < inner.length && inner[i] !== quote) {
        if (inner[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i))
      start = i + 1
    }
  }
  args.push(inner.slice(start))

  return args.map((a) => a.trim()).filter((a) => a.length > 0)
}

/** Split on a TOP-LEVEL occurrence of a one-character operator. */
function topLevelSplit(expr: string, operator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === operator && depth === 0) {
      parts.push(expr.slice(start, i))
      start = i + 1
    }
  }
  parts.push(expr.slice(start))

  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

const TIMING_CALL = /\b(?:performance\.now|Date\.now)\s*\(\s*\)/
/** `const t0 = performance.now()` - binds a TIMESTAMP, which is not yet a duration. */
const TIMESTAMP_BINDING =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(?:performance\.now|Date\.now)\s*\(\s*\)/g
/** `const elapsed = <duration>` - binds a duration to a name. */
const DURATION_BINDING =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^\n;]+)/g
const CLOCK_READ = /^\(?\s*(?:performance\.now|Date\.now)\s*\(\s*\)\s*\)?$/
/** A bound written out: `2500`, `2_500`, `1.5`, or arithmetic over those. */
const NUMERIC_EXPRESSION = /^[-+*/%\s().\d_]+$/
/**
 * `const MAX_MS = 2500` - the SAME bound, spelled so a literal search misses it.
 * This is the form the first version of this detector let through: it only
 * matched a literal in the argument, and a value bound to a name reads as an
 * identifier. Two spellings of one thing is a recurring shape, and the
 * greppable one is never the whole set - `test/helpers/scaling.ts` already
 * writes its own ceiling this way (`MAX_MS = 20_000`).
 */
const NUMERIC_CONSTANT = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([-+*/%\s().\d_]+?)\s*$/gm
/**
 * A test block's opening line.
 *
 * The chained and GENERIC forms both have to be here. `it.each<[number,
 * string]>([...])(...)` is in this suite already, and an opener pattern that
 * required `(` right after the modifier did not match it - which does not merely
 * skip that block, it FOLDS it into the preceding one, so a block sitting after
 * a `perfIt` would inherit its gating and an absolute bound in it would pass.
 */
const BLOCK_OPENER = /^([ \t]*)(perfIt|it|test)((?:\.\w+)*)(?:<[^\n]*>)?\s*\(/gm

export interface Finding {
  file: string
  line: number
  text: string
}

/**
 * Every absolute wall-clock bound in `source` that is NOT inside a `perfIt`.
 *
 * Exported so the self-test below can drive it over a synthetic source. A
 * scanner whose only input is the repo it polices can quietly stop detecting
 * anything and still pass, which is the defect class this whole file is about.
 */
export function ungatedWallClockBounds(source: string, file = '<source>'): Finding[] {
  const findings: Finding[] = []
  // Names bound to a fixed number anywhere in the file, so a bound spelled as a
  // constant counts the same as one spelled as a literal.
  const constants = new Set<string>()
  for (const m of source.matchAll(NUMERIC_CONSTANT)) {
    if (NUMERIC_EXPRESSION.test(m[2]!) && /\d/.test(m[2]!)) constants.add(m[1]!)
  }
  const isAbsolute = (bound: string): boolean =>
    constants.has(bound) || (NUMERIC_EXPRESSION.test(bound) && /\d/.test(bound))
  const openers = [...source.matchAll(BLOCK_OPENER)]

  // Regions, in source order. The FIRST one is everything before the first
  // opener and is ungated: an assertion at module scope runs at collection, and
  // leaving that slice unread would be a hole in exactly the place a scanner is
  // least likely to be checked.
  const regions: Array<{ start: number; end: number; gated: boolean }> = []
  if (openers.length === 0) regions.push({ start: 0, end: source.length, gated: false })
  else {
    if (openers[0]!.index! > 0) regions.push({ start: 0, end: openers[0]!.index!, gated: false })
    for (let b = 0; b < openers.length; b++) {
      const opener = openers[b]!
      const start = opener.index!
      const end = b + 1 < openers.length ? openers[b + 1]!.index! : source.length
      if (opener[2] !== 'perfIt') {
        regions.push({ start, end, gated: false })
        continue
      }
      // A `perfIt` gates ITS OWN CALL, not everything up to the next test.
      // Taking the whole slice would gate any describe- or module-scope code
      // that follows the last `perfIt` in a file, which is a hole exactly where
      // a reader would assume coverage. Bound the gated part at the matching
      // paren and scan whatever comes after it.
      const callOpen = start + opener[0]!.length - 1
      const callClose = matchParen(source, callOpen)
      const gatedEnd = callClose < 0 || callClose >= end ? end : callClose + 1
      regions.push({ start, end: gatedEnd, gated: true })
      if (gatedEnd < end) regions.push({ start: gatedEnd, end, gated: false })
    }
  }

  for (const region of regions) {
    const blockStart = region.start
    if (region.gated) continue
    const block = source.slice(blockStart, region.end)
    if (!TIMING_CALL.test(block)) continue

    // Two passes, because a duration is a DIFFERENCE OF TWO CLOCK READS and
    // either side can be a name rather than a call. `const finished =
    // performance.now()` binds a timestamp, and `finished - started` is the
    // duration; a detector that only understood `performance.now() - started`
    // let that spelling straight through, which is the same one-rule-two-
    // spellings shape as the constant-versus-literal bound above.
    const timestamps = new Set<string>()
    for (const m of block.matchAll(TIMESTAMP_BINDING)) timestamps.add(m[1]!)

    /** A clock read: `performance.now()`, or a name bound to one. */
    const isClockRead = (expr: string): boolean =>
      CLOCK_READ.test(expr) || timestamps.has(expr.trim())

    /** `<clock read> - <clock read>`, however either side is spelled. */
    const isDuration = (expr: string): boolean => {
      const trimmed = expr.trim().replace(/^\((.*)\)$/s, '$1').trim()
      const parts = topLevelSplit(trimmed, '-')
      if (parts.length !== 2) return false

      return isClockRead(parts[0]!) && isClockRead(parts[1]!)
    }

    // Names bound to a duration anywhere in this block.
    const durations = new Set<string>()
    for (const m of block.matchAll(DURATION_BINDING)) {
      if (isDuration(m[2]!)) durations.add(m[1]!)
    }

    let cursor = 0
    for (;;) {
      const at = block.indexOf('expect(', cursor)
      if (at < 0) break
      const open = at + 'expect'.length
      const close = matchParen(block, open)
      if (close < 0) break
      cursor = close + 1

      const subject = topLevelArgs(block.slice(open + 1, close))[0] ?? ''
      if (!durations.has(subject) && !isDuration(subject)) continue

      const tail = block.slice(close + 1)
      const matcher = /^\s*\.\s*(toBeLessThan|toBeLessThanOrEqual)\s*\(/.exec(tail)
      if (!matcher) continue
      const boundOpen = close + matcher[0].length
      const boundClose = matchParen(block, boundOpen)
      if (boundClose < 0) continue
      const bound = block.slice(boundOpen + 1, boundClose).trim()
      if (!isAbsolute(bound)) continue

      const line = source.slice(0, blockStart + at).split('\n').length
      findings.push({ file, line, text: `expect(${subject}).${matcher[1]}(${bound})` })
    }
  }

  return findings
}

describe('the detector itself', () => {
  // The guard below is a scan over the repo, so a scan that matches nothing
  // passes it. These cases pin what it must and must not see, so "no findings"
  // stays evidence rather than an absence of evidence.
  const banned = `
describe('x', () => {
  it('absolute bound on a duration', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2500)
  })
})
`
  const bannedInline = `
describe('x', () => {
  it('absolute bound, inline', () => {
    const started = Date.now()
    work()
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
`
  const bannedWithMessage = `
describe('x', () => {
  it('absolute bound behind a failure message', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(elapsed, 'took (this) long').toBeLessThan(100)
  })
})
`
  const allowedRatio = `
describe('x', () => {
  it('a ratio of two durations', () => {
    const small = time(() => work(1))
    const large = time(() => work(4))
    const elapsed = performance.now() - small
    expect(large / small).toBeLessThan(2)
  })
})
`
  const allowedGated = `
describe('x', () => {
  perfIt('an absolute bound, gated', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  })
})
`
  const allowedCounted = `
describe('x', () => {
  it('counted work, not time', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(steps).toBeLessThan(2000)
  })
})
`

  it('flags an absolute bound on a named duration', () => {
    expect(ungatedWallClockBounds(banned).map((f) => f.text)).toEqual([
      'expect(elapsed).toBeLessThan(2500)',
    ])
  })

  it('flags an absolute bound written inline', () => {
    expect(ungatedWallClockBounds(bannedInline)).toHaveLength(1)
  })

  it('flags one behind a failure message, parens in the message and all', () => {
    expect(ungatedWallClockBounds(bannedWithMessage).map((f) => f.text)).toEqual([
      'expect(elapsed).toBeLessThan(100)',
    ])
  })

  it('reports the line the assertion is on', () => {
    expect(ungatedWallClockBounds(banned)[0]!.line).toBe(7)
  })

  it('does NOT flag a ratio of two durations', () => {
    expect(ungatedWallClockBounds(allowedRatio)).toEqual([])
  })

  it('does NOT flag a bound inside a perfIt block', () => {
    expect(ungatedWallClockBounds(allowedGated)).toEqual([])
  })

  it('does NOT flag a bound on counted work in a block that also times', () => {
    expect(ungatedWallClockBounds(allowedCounted)).toEqual([])
  })

  it('flags a bound spelled as a named constant, not only as a literal', () => {
    // The blind spot the first version of this detector had, and the reason it
    // is worth pinning: the bound is the same number, and only its SPELLING
    // moved out of the argument.
    const viaConstant = `
const MAX_MS = 2500

describe('x', () => {
  it('absolute bound behind a name', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(MAX_MS)
  })
})
`
    expect(ungatedWallClockBounds(viaConstant).map((f) => f.text)).toEqual([
      'expect(elapsed).toBeLessThan(MAX_MS)',
    ])
  })

  it('flags a bound written as arithmetic over literals', () => {
    const viaArithmetic = `
describe('x', () => {
  it('absolute bound, computed', () => {
    const start = performance.now()
    work()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2.5 * 1000)
  })
})
`
    expect(ungatedWallClockBounds(viaArithmetic)).toHaveLength(1)
  })

  it('flags a duration computed from two stored timestamps', () => {
    // The second spelling the detector missed: neither side of the subtraction
    // is a call, so a pattern anchored on `performance.now() - x` sees nothing.
    const viaTwoStamps = `
describe('x', () => {
  it('absolute bound on a difference of names', () => {
    const started = performance.now()
    work()
    const finished = performance.now()
    expect(finished - started).toBeLessThan(100)
  })
})
`
    expect(ungatedWallClockBounds(viaTwoStamps).map((f) => f.text)).toEqual([
      'expect(finished - started).toBeLessThan(100)',
    ])
  })

  it('flags a NAMED duration computed from two stored timestamps', () => {
    const viaTwoStampsNamed = `
describe('x', () => {
  it('absolute bound on a named difference of names', () => {
    const started = Date.now()
    work()
    const finished = Date.now()
    const took = finished - started
    expect(took).toBeLessThan(2_500)
  })
})
`
    expect(ungatedWallClockBounds(viaTwoStampsNamed)).toHaveLength(1)
  })

  it('does NOT flag a difference of two things that are not clock reads', () => {
    // The cost of understanding `a - b`: it must not fire on a subtraction of
    // counters just because the block happens to also read a clock.
    const viaCounters = `
describe('x', () => {
  it('counted work, expressed as a difference', () => {
    const before = steps.count
    const start = performance.now()
    work()
    const after = steps.count
    expect(after - before).toBeLessThan(2000)
  })
})
`
    expect(ungatedWallClockBounds(viaCounters)).toEqual([])
  })

  it('flags a bound inside a typed parameterized block', () => {
    // `it.each<[...]>(...)(...)` is in this suite already. An opener that missed
    // it would fold the block into whatever came before, so this case also pins
    // that a preceding perfIt cannot lend it a gate.
    const viaTypedEach = `
describe('x', () => {
  perfIt('a gated one first, to lend its gate if the opener misses', () => {
    const start = performance.now()
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it.each<[number, string]>([[1, 'a']])('case %i', (n, label) => {
    const start = performance.now()
    work(n, label)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(250)
  })
})
`
    expect(ungatedWallClockBounds(viaTypedEach).map((f) => f.text)).toEqual([
      'expect(elapsed).toBeLessThan(250)',
    ])
  })

  it('flags a bound at module scope, before any block', () => {
    const viaModuleScope = `
const start = performance.now()
const elapsed = performance.now() - start
expect(elapsed).toBeLessThan(10)

describe('x', () => {
  it('an ordinary case', () => {
    expect(1).toBe(1)
  })
})
`
    expect(ungatedWallClockBounds(viaModuleScope)).toHaveLength(1)
  })

  it('flags a bound that FOLLOWS the last perfIt in the file', () => {
    // A perfIt gates its own call. Anything after it is describe- or
    // module-scope code that runs in the everyday suite like everything else.
    const afterPerfIt = `
describe('x', () => {
  perfIt('gated', () => {
    const start = performance.now()
    expect(performance.now() - start).toBeLessThan(5000)
  })

  const started = performance.now()
  warm()
  const elapsed = performance.now() - started
  expect(elapsed).toBeLessThan(42)
})
`
    expect(ungatedWallClockBounds(afterPerfIt).map((f) => f.text)).toEqual([
      'expect(elapsed).toBeLessThan(42)',
    ])
  })

  it('does NOT flag a bound that is itself a measurement', () => {
    // A duration compared against ANOTHER duration is a ratio in another shape,
    // and load cancels out of it the same way. Only a fixed number is banned.
    const viaMeasured = `
describe('x', () => {
  it('one run against another', () => {
    const baseline = time(() => work(1))
    const start = performance.now()
    work(1)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(baseline * 4)
  })
})
`
    expect(ungatedWallClockBounds(viaMeasured)).toEqual([])
  })
})

describe('the everyday suite', () => {
  // THIS FILE is the one exclusion, and only because its `describe` above holds
  // deliberately banned samples as strings - the detector's own fixtures. They
  // are the reason "no findings" below is evidence: the cases just above prove
  // the same scanner does flag exactly those shapes.
  const SELF = 'no-ungated-wall-clock-budget.test.ts'
  const files = testFiles(TEST_DIR).filter((file) => !file.endsWith(SELF))

  it('has test files to scan at all', () => {
    // The other half of the same hole: an empty file list makes the guard below
    // pass while looking at nothing.
    expect(files.length).toBeGreaterThan(100)
  })

  it('excludes only itself, and only because it holds the fixtures', () => {
    // A by-name exclusion is a blind spot, so pin that there is exactly one and
    // that it is this file. A second name appearing here is a decision, not a
    // detail.
    const all = testFiles(TEST_DIR)
    expect(all.length - files.length).toBe(1)
    expect(all.filter((file) => !files.includes(file)).map((f) => f.slice(TEST_DIR.length))).toEqual(
      [SELF],
    )
  })

  it('still contains blocks that measure wall-clock time', () => {
    // And so the scan is still being pointed at something it could flag. If
    // every timing test left the repo this would fail, which is the right time
    // to reconsider the guard rather than to keep a scanner nothing feeds.
    const timing = files.filter((file) => TIMING_CALL.test(readFileSync(file, 'utf8')))
    expect(timing.length).toBeGreaterThan(5)
  })

  it('asserts no measured duration against an absolute number', () => {
    const findings = files.flatMap((file) =>
      ungatedWallClockBounds(readFileSync(file, 'utf8'), file.slice(TEST_DIR.length)),
    )

    expect(
      findings.map((f) => `${f.file}:${f.line}  ${f.text}`),
      'An absolute wall-clock bound in the everyday suite reports how busy the ' +
        'machine is, not how the code behaves - carve-js#1268 went red at 2651ms ' +
        'against 2500ms on unchanged main at loadavg 36. Count the work instead, ' +
        'or compare two durations from the same run, or move it into a perfIt ' +
        'block so it runs under npm run test:perf on a runner of its own.',
    ).toEqual([])
  })
})
