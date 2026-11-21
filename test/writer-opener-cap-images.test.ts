// C2-I-118: the reader counts open brackets, the delimiters inside them and the openers of an image's alt text toward
// the cap of 200. The writer keeps a run of openers past the cap as it is, also where an image stands behind it.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

function roundTrip(source: string): string {
  const written = formatWithDiagnostics(source)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  expect(formatWithDiagnostics(written.source).source).toBe(written.source)
  return written.source
}

function unchanged(source: string): void {
  expect(roundTrip(source)).toBe(source)
}

describe('runs of openers past the depth cap before images', () => {
  it('C2-W-002: fmt keeps the run and the images on both sides of the cap', () => {
    for (const count of [100, 101, 110]) unchanged(`${'{+!['.repeat(count)}]()]()\n`)
    unchanged(`${'{-!['.repeat(101)}]()]()\n`)
    roundTrip(`${'{-=!['.repeat(101)}]()]()\n`)
    unchanged(`${'{+>!['.repeat(101)}]()]()\n`)
  })

  it('C2-W-002: bare delimiters inside text brackets count toward the cap', () => {
    unchanged(`${'{+*!['.repeat(69)}]()]()\n`)
    unchanged(`${'{-*!['.repeat(69)}]()]()\n`)
    unchanged(`${'{+[!['.repeat(68)}]()]()\n`)
    roundTrip(`[${'[{^'.repeat(100)}[]]()\n`)
  })

  it('C2-W-133: a run of braced openers without brackets stays on the plan and linear', () => {
    const unit = '{/a {/b /} { '
    const time = (copies: number): number => {
      const source = `${unit.repeat(copies)}\n`
      const started = performance.now()
      formatWithDiagnostics(source)
      return performance.now() - started
    }
    time(80)
    const small = Math.min(time(80), time(80))
    const large = Math.min(time(320), time(320))
    expect(large).toBeLessThan(Math.max(small, 2) * 16)
  })
})
