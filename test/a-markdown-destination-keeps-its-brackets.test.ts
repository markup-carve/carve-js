import { describe, expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve, carveToHtml } from '../src/index.js'

/**
 * carve#2865. A Carve `(...)` destination holds a square bracket literally, and
 * the Markdown writer emits it literally, so percent-encoding it on the way back
 * changed the address a reader copies and broke the render/import round trip.
 * The Djot importer was ruled the same way in carve#2854.
 */
describe('PART 11 §5 Markdown destination brackets', () => {
  it.each([
    '[x](http://u/])',
    '[x](http://u/[)',
    '[x](http://u/[a])',
    '![x](http://u/[a])',
    '[x](http://u/] "t]")',
  ])('round-trips %s through Markdown unchanged', (source) => {
    const markdown = carveToMarkdown(source).trimEnd()
    expect(markdown).toBe(source)
    expect(markdownToCarve(markdown)).toBe(source)
  })

  it('keeps the characters a destination genuinely cannot hold encoded', () => {
    expect(markdownToCarve('[x](http://u/`|<>)')).toBe('[x](http://u/`|<>)')
  })

  it('leaves the conservative label escape alone, which renders the same', () => {
    const source = 'a [b [x](u) c]'
    const markdown = carveToMarkdown(source).trimEnd()
    expect(markdown).toBe('a [b [x](u) c\\]')
    expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(source))
  })
})
