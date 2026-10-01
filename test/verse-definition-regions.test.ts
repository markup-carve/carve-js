import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('definition collection follows verse ownership', () => {
  it('registers a definition after a closed verse in a list item', () => {
    const html = carveToHtml('- ::: |\n  verse\n  :::\n\n  [r]: /target\n\n[t][r]\n')
    expect(html).toContain('href="/target"')
  })

  it('keeps definitions literal after a lazy list continuation', () => {
    const html = carveToHtml('- ::: |\n  verse\nlazy\n  [r]: /hidden\n  :::\n\n[t][r]\n')
    expect(html).toContain('[r]: /hidden')
    expect(html).not.toContain('href="/hidden"')
  })

  it('keeps a colon closer inside a closed comment span literal', () => {
    const html = carveToHtml('::: |\n%%%\n:::\n[r]: /target\n%%%\n\n[t][r]\n')
    expect(html).toContain('[r]: /target')
    expect(html).not.toContain('href="/target"')
  })
  it('keeps an attached code span and its colon line inside verse', () => {
    const html = carveToHtml('> ::: |\n> verse\n+\n```\n:::\n```\n> [r]: /hidden\n> :::\n\n[t][r]\n')
    expect(html).toContain('[r]: /hidden')
    expect(html).not.toContain('href="/hidden"')
    expect(html).not.toContain('\uE005')
  })

})
