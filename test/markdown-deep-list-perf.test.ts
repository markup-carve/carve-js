import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToMarkdown, carveToPlainText } from '../src/index.js'
import { trimEndNonNbsp, trimNonNbsp, trimStartNonNbsp } from '../src/trim-non-nbsp.js'

// The same defect as `writer-deep-list-perf.test.ts`, in the three targets that
// were left behind when it was fixed. carve-js#638 made the canonical writer's
// trims scans from the end; `render-markdown`, `render-plain` and `render-ansi`
// each kept their own copy of
//
//     text.replace(/^[^\S\u00a0]+|[^\S\u00a0]+$/g, '')
//
// which the engine retries from position after position, rescanning every
// interior whitespace run it meets.
//
// Markdown is where that surfaced again (carve-js#701): it re-indents each list
// level by rendering the whole subtree and trimming it, so a ladder of depth N
// is trimmed N times over a string that is itself O(N^2) characters of
// indentation. Depth 50 took 6.4s and depth 80 did not return inside a minute -
// on documents the parse cap accepts, so the Markdown target was unusable rather
// than merely slow. Plain text and the terminal never fed it a string long
// enough to notice, which is why one shared helper replaced three copies.
//
// THE TRIM'S OUTPUT IS UNCHANGED, which is the part worth stating: all 610
// corpus documents were rendered to Markdown, plain text, ANSI, Carve and HTML
// before and after, and all 3050 renders are byte-identical.

const ladder = (depth: number): string => {
  const lines: string[] = []
  for (let i = 0; i < depth; i++) lines.push(`${'  '.repeat(i)}- x`)

  return `${lines.join('\n')}\n`
}

describe('the Markdown target on a deep list ladder', () => {
  it('renders 80 levels well inside a second', () => {
    // Warm up: the cold call carries JIT compilation, as every other perf guard
    // in this repo notes.
    carveToMarkdown(ladder(20))

    const start = performance.now()
    const out = carveToMarkdown(ladder(80))
    const elapsed = performance.now() - start

    expect(out).toContain('- x')
    // ~0.03s warm. The superlinear form did not return inside 60s, so a generous
    // bound separates them without timing flakiness.
    expect(elapsed).toBeLessThan(5000)
  })

  // NO RATIO CASE HERE, deliberately. The obvious one - compare depth 80 against
  // depth 40 - cannot fail on the defect it would guard: depth 40 took 1916ms and
  // depth 80 never returned, so the only ratio ever observed is a floor of ~31,
  // inside any bound loose enough not to flake. The two absolute bounds above
  // separate 0.03s from "did not finish" by three orders, which is the honest
  // version of the same check.

  it('renders the deepest document the parse cap accepts', () => {
    carveToMarkdown(ladder(20))

    const start = performance.now()
    carveToMarkdown(ladder(200))
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(15000)
  })


  it('leaves plain text and the terminal fast too', () => {
    // They share the helper now, so a regression in it would show here first -
    // these two never built a string long enough to expose the old form.
    for (const render of [carveToPlainText, carveToAnsi]) {
      render(ladder(20))
      const start = performance.now()
      render(ladder(200))
      expect(performance.now() - start).toBeLessThan(15000)
    }
  })
})

describe('the shared trim', () => {
  it('keeps a non-breaking space at either end', () => {
    // The whole reason these targets cannot use String.prototype.trim: NBSP is
    // content the author wrote, as a `\\ ` escape or a `:nbsp:` symbol.
    //
    // Written as escapes on purpose. A literal nbsp is indistinguishable from a
    // space on screen, and the difference between them is the entire assertion.
    const NBSP = '\u00a0'

    expect(trimNonNbsp(`${NBSP}x${NBSP}`)).toBe(`${NBSP}x${NBSP}`)
    // A space OUTSIDE the nbsp goes; the nbsp itself stops the scan.
    expect(trimNonNbsp(`  ${NBSP}x${NBSP}  `)).toBe(`${NBSP}x${NBSP}`)
    expect(trimStartNonNbsp(`  ${NBSP}x`)).toBe(`${NBSP}x`)
    expect(trimEndNonNbsp(`x${NBSP}  `)).toBe(`x${NBSP}`)
    // And a space INSIDE it stays, because the nbsp already stopped the scan.
    expect(trimEndNonNbsp(`x${NBSP} ${NBSP}`)).toBe(`x${NBSP} ${NBSP}`)
  })

  it('trims every other whitespace character, including the exotic ones', () => {
    // `[^\S\u00a0]` is `\s` minus NBSP, so the replacement has to agree with
    // `\s` on characters a hand-written ASCII list would miss.
    for (const ws of [' ', '\t', '\n', '\r', '\v', '\f', ' ', ' ', '　', '﻿']) {
      expect(trimNonNbsp(`${ws}x${ws}`)).toBe('x')
    }
  })

  it('leaves interior whitespace alone', () => {
    expect(trimNonNbsp('  a  b  ')).toBe('a  b')
    expect(trimNonNbsp('a\n\nb')).toBe('a\n\nb')
  })

  it('handles a string that is entirely whitespace, and one that is entirely NBSP', () => {
    expect(trimNonNbsp('   \n\t ')).toBe('')
    expect(trimNonNbsp('\u00a0\u00a0')).toBe('\u00a0\u00a0')
    expect(trimNonNbsp('')).toBe('')
  })

  it('trims a long indented string in one pass', () => {
    // A RATIO does not discriminate here: over 400 -> 1600 lines the regex form
    // grew ~15x, inside any bound loose enough to be stable. A single call on a
    // string big enough separates them by three orders instead - 1.3 million
    // characters took the regex 1375ms and takes this under a millisecond.
    const text = `${Array.from({ length: 1600 }, (_, i) => `${' '.repeat(i)}x`).join('\n')}\n`
    expect(text.length).toBeGreaterThan(1_000_000)

    trimNonNbsp('  warm  ')
    const start = performance.now()
    const out = trimNonNbsp(text)
    const elapsed = performance.now() - start

    expect(out.startsWith('x')).toBe(true)
    expect(elapsed).toBeLessThan(100)
  })
})
