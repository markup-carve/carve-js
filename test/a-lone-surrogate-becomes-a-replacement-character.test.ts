import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'
import { replaceLoneSurrogates } from '../src/well-formed.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// An oracle independent of the code under test (String#isWellFormed is ES2024).
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const wellFormed = (text: string): boolean => !LONE.test(text)

/**
 * A lone surrogate in an API string becomes U+FFFD before parsing
 * (carve#3212, CARVE-P0-023), so every output string is well-formed.
 */
describe('a lone surrogate', () => {
  it('is replaced in a paragraph, and the emphasis after it still parses', () => {
    const html = carveToHtml('a\uD800b *x*')
    expect(html).toBe(carveToHtml('a�b *x*'))
    expect(html).toContain('<strong>x</strong>')
    expect(wellFormed(html)).toBe(true)
  })

  it('never reaches a heading id', () => {
    const html = carveToHtml('# a\uD800b')
    expect(html).toBe(carveToHtml('# a�b'))
    expect(wellFormed(html)).toBe(true)
  })

  it('takes one U+FFFD per unpaired code unit, a reversed pair included', () => {
    expect(carveToHtml('a\uDC00b')).toBe(carveToHtml('a�b'))
    expect(carveToHtml('a\uDC00\uD800b')).toBe(carveToHtml('a��b'))
    expect(carveToHtml('a\uD800')).toBe(carveToHtml('a�'))
  })

  it('is replaced on every output target and in the AST', () => {
    const source = 'a\uD800b'
    expect(wellFormed(carveToMarkdown(source))).toBe(true)
    expect(wellFormed(carveToPlainText(source))).toBe(true)
    expect(JSON.stringify(carveToAstJson(source))).toContain('a�b')
  })

  it('keeps positions on the original offsets', () => {
    // One code unit for one, so the span after it is unmoved.
    const source = 'a\uD800b *x*'
    const doc = carveToAstJson(source) as any
    const strong = doc.children[0].children.at(-1)
    expect(source.slice(strong.pos.startOffset, strong.pos.endOffset)).toBe('*x*')
  })
})

describe('a well-formed string', () => {
  it('leaves an astral character untouched', () => {
    // The control: a pass replacing every surrogate code unit would turn
    // U+1F600 into two U+FFFD.
    expect(carveToHtml('a\u{1F600}b *x*')).toContain('a\u{1F600}b')
    expect(carveToHtml('# a\u{1F600}b')).not.toContain('�')
  })

  it('leaves a noncharacter as content', () => {
    expect(carveToHtml('a￾b﷐c')).toContain('a￾b﷐c')
  })

  it('is returned as the same string', () => {
    const text = 'plain \u{1F600} text'
    expect(replaceLoneSurrogates(text)).toBe(text)
  })
})

describe('replaceLoneSurrogates', () => {
  it('pairs only a high surrogate directly followed by a low one', () => {
    const text = '\uD800'.repeat(3) + '\uDC00'.repeat(3)
    const out = replaceLoneSurrogates(text)
    expect(out.length).toBe(text.length)
    expect(wellFormed(out)).toBe(true)
    expect(out).toBe('\uFFFD\uFFFD\uD800\uDC00\uFFFD\uFFFD')
  })

  perfIt('scans a run of lone surrogates linearly', () => {
    expectScansLinearly((input) => void replaceLoneSurrogates(input), '\uDC00a\uD800', {
      smallRepeats: 4096, minSampleMs: 100,
    })
  }, 90000)

  perfIt('parses a document of lone surrogates linearly', () => {
    expectScansLinearly((input) => void carveToHtml(input), 'a\uD800 ', {
      smallRepeats: 1024, minSampleMs: 100,
    })
  }, 90000)
})
