import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToAnsi, carveToPlainText } from '../src/index.js'

describe('Severity-2 renderer content loss', () => {
  it('subscript is not strikethrough in markdown/ansi', () => {
    expect(carveToMarkdown('H{,2,}O').trim()).toBe('H<sub>2</sub>O')
    expect(carveToAnsi('H{,2,}O').trim()).toBe('H₂O')
  })

  it('admonition title is preserved in non-HTML renderers', () => {
    expect(carveToMarkdown(':::note "Heads up"\nbody\n:::')).toContain('**Heads up**')
    expect(carveToPlainText(':::note "Heads up"\nbody\n:::')).toContain('Heads up')
  })

  it('nested strong in a title does not emit degenerate bold-in-bold', () => {
    // The title line is already bold; inner strong unwraps instead of
    // emitting `**a **b****` (broken CommonMark) or a mid-title SGR reset.
    expect(carveToMarkdown('::: note "a *b* `c`"\nx\n:::')).toContain('**a b `c`**')
    expect(carveToMarkdown('::: note "a /em/ d"\nx\n:::')).toContain('**a *em* d**')
    expect(carveToAnsi('::: note "a *b*"\nx\n:::')).toContain('\u001b[1ma b\u001b[0m')
  })

  it('critic-substitute keeps both old and new text', () => {
    expect(carveToMarkdown('{~old~>new~}').trim()).toBe('<del>old</del><ins>new</ins>')
    expect(carveToPlainText('{~old~>new~}')).toContain('old')
    expect(carveToPlainText('{~old~>new~}')).toContain('new')
  })
})
