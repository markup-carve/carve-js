import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#4953: each comment line restored after a paragraph rebuilt the sibling index.
describe('erased comment lines restored into their host', () => {
  it('still continue the paragraph across the erased lines', () => {
    expect(carveToHtml('a\n%%\n%%\nz\n')).toBe('<p>a\nz</p>')
    expect(carveToHtml('> > - a\n> >   %%\n> >   %%\n> >   z\n')).toBe(
      '<blockquote>\n  <blockquote>\n    <ul>\n      <li>a\nz</li>\n    </ul>\n  </blockquote>\n</blockquote>')
  })

  const shapes: Record<string, [prefix: string, line: string, suffix: string]> = {
    paragraph: ['a\n', '%%\n', 'z\n'],
    item: ['- a\n', '  %%\n', '  z\n'],
    quote: ['> a\n', '> %%\n', '> z\n'],
    'nested quoted item': ['> > - a\n', '> >   %%\n', '> >   z\n'],
    'paragraph per comment': ['', 'a\n%%\nz\n\n', ''],
  }
  for (const [label, [prefix, line, suffix]] of Object.entries(shapes)) {
    perfIt(`restores the ${label} comment lines in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), line, { label, prefix, suffix, smallRepeats: 1000 })
    })
  }

  perfIt('restores abbreviation lines in a paragraph in linear time', () => {
    let next = 0
    expectScansLinearly((input) => void carveToHtml(input.replace(/\*\[A\]/g, () => `*[A${next++}]`)), '*[A]: x\n',
      { label: 'abbreviation', prefix: 'a\n', suffix: 'z\n', smallRepeats: 1000 })
  })
})
