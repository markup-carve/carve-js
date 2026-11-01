import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

describe('invisible lines between siblings (carve#4716)', () => {
  it.each([
    ['comment', '%% c'],
    ['reference', '[r]: /u'],
    ['abbreviation', '*[X]: expansion'],
  ])('keeps list siblings together across a %s', (_kind, invisible) => {
    expect(carveToHtml(`- a\n${invisible}\n- b\n`)).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
  })

  it.each([
    ['comment', '%% c'],
    ['reference', '[r]: /u'],
    ['abbreviation', '*[X]: expansion'],
  ])('keeps a description with its term across a %s', (_kind, invisible) => {
    expect(carveToHtml(`:: t\n${invisible}\n: d\n`)).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
  })

  it('registers a skipped abbreviation before parsing the term', () => {
    expect(carveToHtml(':: X\n*[X]: expansion\n: Y\n')).toBe(
      '<dl>\n  <dt><abbr title="expansion">X</abbr></dt>\n  <dd>Y</dd>\n</dl>',
    )
  })

  it('keeps a container-local abbreviation line as text', () => {
    expect(carveToHtml('> :: t\n> *[X]: expansion\n> : d\n')).toContain('<dt>t\n*[X]: expansion</dt>')
  })
})

describe('description-list hard boundary (carve#4759)', () => {
  const separated = ':: t\n: x\n\n\n\n:: u\n: v\n'
  const html = '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<dl>\n  <dt>u</dt>\n  <dd>v</dd>\n</dl>'

  it('splits two description lists after three blank lines', () => {
    expect(carveToHtml(separated)).toBe(html)
    expect(renderCarve(parse(separated))).toBe(separated)
  })

  it('writes a hard boundary between adjacent description-list nodes', () => {
    const first = parse(':: t\n: x\n').children[0]!
    const second = parse(':: u\n: v\n').children[0]!
    const written = renderCarve({ type: 'document', children: [first, second] })
    expect(written).toBe(separated)
    expect(carveToHtml(written)).toBe(html)
  })

  it('counts blanks across an invisible line', () => {
    const source = ':: t\n: x\n\n%% c\n\n\n:: u\n: v\n'
    expect(carveToHtml(source)).toBe(html)
  })
})
