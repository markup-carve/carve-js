import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// markup-carve/carve#1718 and the caption clause in markup-carve/carve#1742.
// A fenced quote IS a block quote, so it captions like one: the slot hangs on
// its CLOSING fence, as the figure group's does, and a captioned quote is a
// figure either way. Asserting against the prefixed spelling rather than
// pinning HTML, since the whole point is that the two agree.

describe('a caption after a fenced block quote', () => {
  it('wraps it in a figure, exactly as the prefixed spelling does', () => {
    expect(carveToHtml('::: >\nStay hungry.\n:::\n^ Steve Jobs\n')).toBe(
      carveToHtml('> Stay hungry.\n^ Steve Jobs\n'),
    )
  })

  it('still allows one blank line between the closer and the caption', () => {
    expect(carveToHtml('::: >\nStay hungry.\n:::\n\n^ Steve Jobs\n')).toBe(
      carveToHtml('> Stay hungry.\n\n^ Steve Jobs\n'),
    )
  })

  it('leaves the quote its own source span, as every caption host does', () => {
    // Without this the captioned fenced quote was the one block quote in the
    // vocabulary with no `pos`: the figure carried the span and its target
    // carried none.
    const figure = (parse('::: >\nStay hungry.\n:::\n^ Steve Jobs\n') as {
      children: { pos?: unknown; target?: { pos?: unknown } }[]
    }).children[0]!
    expect(figure.pos).toBeDefined()
    expect(figure.target?.pos).toBeDefined()
  })
})
