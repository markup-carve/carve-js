import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('reference definition separators are only spaces', () => {
  it.each(['\t', '\f', '\u00a0', '\u202f'])('keeps %j after the separator as paragraph content', (ch) => {
    const source = ['[t][a]', '', `[a]: ${ch}/u`].join('\n')
    expect(carveToHtml(source)).toBe(`<p>[t][a]</p>\n<p>[a]: ${ch === '\u00a0' ? '&nbsp;' : ch}/u</p>`)
  })

  it('keeps a narrow no-break space before a scheme in paragraph content', () => {
    const source = ['[click][a]', '', '[a]: \u202fjavascript:alert(1)'].join('\n')
    expect(carveToHtml(source)).toBe('<p>[click][a]</p>\n<p>[a]: \u202fjavascript:alert(1)</p>')
  })

  it.each([' ', '  ', '   '])('accepts a separator of %j', (spaces) => {
    expect(carveToHtml(['[t][a]', '', `[a]:${spaces}/u`].join('\n')))
      .toBe('<p><a href="/u">t</a></p>')
  })

  it('requires a separator space', () => {
    expect(carveToHtml(['[t][a]', '', '[a]:/u'].join('\n')))
      .toBe('<p>[t][a]</p>\n<p>[a]:/u</p>')
  })
})
