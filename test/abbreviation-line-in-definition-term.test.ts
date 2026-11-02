import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('abbreviation-shaped line in a definition term', () => {
  it('ends the term at the definition and leaves the follower outside', () => {
    expect(carveToHtml(':: term\n*[A]: b\nSee [r][].\n')).toBe(
      '<dl>\n  <dt>term</dt>\n</dl>\n<p>See [r][].</p>',
    )
  })

  it('keeps a plain continuation in the term', () => {
    expect(carveToHtml(':: term\nplain\n')).toBe('<dl>\n  <dt>term\nplain</dt>\n</dl>')
  })
})
