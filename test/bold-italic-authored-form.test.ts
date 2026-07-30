import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * The combined bold-italic form is a single production, and the nested spelling
 * parses to the SAME strong-wrapping-emphasis tree - so the nesting does not
 * record which one the author wrote.
 *
 * The writer therefore normalized the spelling Carve documents (cheatsheet,
 * migrate-from-markdown) into one documented nowhere. `boldItalic` carries the
 * answer (PART 11 §6, PART 12 §3; carve#375).
 */
const COMBINED = '/*x*/'
const NESTED = '*/x/*'

describe('the authored bold-italic spelling survives a format', () => {
  it('marks the combined form and only the combined form', () => {
    const strongOf = (src: string) => parse(src).children[0].children[0]
    expect(strongOf(COMBINED).boldItalic).toBe(true)
    expect(strongOf(NESTED).boldItalic).toBeUndefined()
  })

  it('reproduces each spelling byte-exactly', () => {
    expect(carveToCarve(COMBINED)).toBe(`${COMBINED}\n`)
    expect(carveToCarve(NESTED)).toBe(`${NESTED}\n`)
  })

  it('renders both to the same HTML, which is why the mark is needed', () => {
    expect(carveToHtml(COMBINED)).toBe(carveToHtml(NESTED))
  })

  it('keeps the mid-word form, which only the combined production accepts', () => {
    // A bare `/` needs a word boundary, so `a*/y/*b` is not the same document -
    // this spelling exists precisely because the two-char token skips that guard.
    expect(carveToCarve('a/*y*/b\n')).toBe('a/*y*/b\n')
  })

  it('keeps italic nested inside bold italic', () => {
    const src = '/*a /b/ c*/\n'
    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('leaves an ordinary strong alone', () => {
    expect(carveToCarve('*x*\n')).toBe('*x*\n')
  })

  it('stays idempotent and meaning-preserving for every spelling', () => {
    for (const src of [COMBINED, NESTED, '/*bold italic*/', 'a/*y*/b', '/*a /b/ c*/']) {
      const once = carveToCarve(src)
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(src))
    }
  })
})
