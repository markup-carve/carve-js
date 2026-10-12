import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('label keys collapse only spaces', () => {
  it.each(['\t', '\f', '\u00a0'])('keeps %j as label content', (ch) => {
    const source = [`see [t][a${ch}b]`, '', '[a b]: /u'].join('\n')
    expect(carveToHtml(source)).toBe(`<p>see [t][a${ch === '\u00a0' ? '&nbsp;' : ch}b]</p>`)
    const note = [`see [^a${ch}b]`, '', '[^a b]: note'].join('\n')
    expect(carveToHtml(note)).toBe(`<p>see [^a${ch === '\u00a0' ? '&nbsp;' : ch}b]</p>`)
  })

  it.each(['\t', '\f'])('resolves identical %j label content', (ch) => {
    expect(carveToHtml([`[t][a${ch}b]`, '', `[a${ch}b]: /u`].join('\n')))
      .toBe('<p><a href="/u">t</a></p>')
    expect(carveToHtml([`[^a${ch}b]`, '', `[^a${ch}b]: note`].join('\n')))
      .toContain('doc-noteref')
  })

  it('collapses space runs and trims spaces', () => {
    expect(carveToHtml(['[t][ a  b ]', '', '[a b]: /u'].join('\n')))
      .toBe('<p><a href="/u">t</a></p>')
  })

  it('does not resolve a label across a line break', () => {
    expect(carveToHtml(['[t][a', 'b]', '', '[a b]: /u'].join('\n'))).not.toContain('href=')
    expect(carveToHtml(['[^a', 'b]', '', '[^a b]: note'].join('\n'))).not.toContain('doc-noteref')
  })
})
