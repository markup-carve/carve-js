import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, carveToCarve } from '../src/index.js'

describe('ill-formed Unicode at the parse boundary', () => {
  it.each([
    ['lone high surrogate', 'a\uD800b *x*', 'a\uFFFDb *x*'],
    ['lone low surrogate', 'a\uDC00b *x*', 'a\uFFFDb *x*'],
    ['reversed pair', '\uDC00\uD800', '\uFFFD\uFFFD'],
    ['paired surrogate', 'a\uD83D\uDE00b', 'a😀b'],
    ['terminal high surrogate', 'x\uDBFF', 'x\uFFFD'],
  ])('%s', (_name, source, normalized) => {
    expect(carveToHtml(source)).toBe(carveToHtml(normalized))
    expect(carveToAstJson(source)).toEqual(carveToAstJson(normalized))
    expect(carveToCarve(source)).toBe(carveToCarve(normalized))
  })

  it('does not write a lone surrogate into a heading id', () => {
    const html = carveToHtml('# a\uD800b')
    expect(html).toBe(carveToHtml('# a\uFFFDb'))
    expect(html).toContain('id="a\uFFFDb"')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(html)).toBe(false)
  })

  it('keeps noncharacters and positions after a leading BOM', () => {
    expect(carveToHtml('a\uFFFEb')).toContain('\uFFFE')
    expect(carveToAstJson('\uFEFFa\uD800b')).toEqual(carveToAstJson('\uFEFFa\uFFFDb'))
  })
})
