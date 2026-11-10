import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// carve#5870: every `{%` line rescanned the paragraph to the run's `%}`.
describe('a paragraph of lazy `{%` opener lines', () => {
  it('keeps the openers as item text', () => {
    expect(carveToHtml('- x\n{% a\n{% a\n z %}\n')).toBe('<ul>\n  <li>x\n{% a\n{% a\nz %}</li>\n</ul>')
  })

  it('keeps the quoted openers as item text', () => {
    expect(carveToHtml('> - x\n> {% a\n> {% a\n>  z %}\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>x\n{% a\n{% a\nz %}</li>\n  </ul>\n</blockquote>')
  })

  const shapes: Record<string, [prefix: string, line: string, suffix: string]> = {
    item: ['- x\n', '{% a\n', ' z %}\n'],
    quote: ['> - x\n', '> {% a\n', '>  z %}\n'],
    'nested quote': ['> > - x\n', '> > {% a\n', '> >  z %}\n'],
  }
  for (const [label, [prefix, line, suffix]] of Object.entries(shapes)) {
    perfIt(`parses the ${label} openers in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), line, { label, prefix, suffix, smallRepeats: 1000 })
    })
  }
})
