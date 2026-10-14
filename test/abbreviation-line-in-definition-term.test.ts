import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('abbreviation-shaped line in a definition term', () => {
  it('keeps the line and its follower in the term', () => {
    expect(carveToHtml(':: term\n*[A]: b\nSee [r][].\n')).toBe(
      '<dl>\n  <dt>term\n*[A]: b\nSee [r][].</dt>\n</dl>',
    )
  })

  it('keeps a plain continuation in the term', () => {
    expect(carveToHtml(':: term\nplain\n')).toBe('<dl>\n  <dt>term\nplain</dt>\n</dl>')
  })
})
