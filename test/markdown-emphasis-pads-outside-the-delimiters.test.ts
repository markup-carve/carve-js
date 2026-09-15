import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A delimiter run only OPENS emphasis while it is left-flanking, which a run
 * followed by whitespace never is (CommonMark 6.2), so `** x**` reads back as
 * literal text and the emphasis is lost on the way out. The padding is
 * content, so it moves outside the delimiters instead of being trimmed. At a
 * paragraph edge Markdown collapses it either way; mid-paragraph it survives.
 */
describe('the Markdown renderer keeps padded emphasis readable as emphasis', () => {
  it('moves leading padding outside a strong run', () => {
    expect(carveToMarkdown('a{* b*}c\n')).toContain('a **b**c')
  })

  it('moves trailing padding outside a strong run', () => {
    expect(carveToMarkdown('a{*b *}c\n')).toContain('a**b** c')
  })

  it('moves padding outside an emphasis run', () => {
    expect(carveToMarkdown('a{/ i /}b\n')).toContain('a *i* b')
  })

  it('moves padding outside a strikethrough run', () => {
    expect(carveToMarkdown('a{~ s ~}b\n')).toContain('a ~~s~~ b')
  })

  it('never emits a run that cannot open emphasis', () => {
    expect(carveToMarkdown('a{* b*}c\n')).not.toContain('** b')
  })

  it('falls back to inline HTML when the content is only padding', () => {
    expect(carveToMarkdown('a{* *}b\n')).toContain('a<strong> </strong>b')
  })

  it('leaves an unpadded run exactly as it was', () => {
    expect(carveToMarkdown('x {*y*} z\n')).toContain('x **y** z')
  })
})
