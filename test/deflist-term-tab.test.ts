import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `definition_term = "::", space, inline_content, newline` and `space = ' '`,
 * so the separator after `::` is the space character - a tab does not satisfy
 * it, and the line is ordinary paragraph text.
 *
 * Every other marker whose separator the grammar specifies as a space already
 * refused a tab here: `-`, `1.`, `#`, `>`, `[a]:`, `[^a]:` and `*[A]:`. The
 * definition term was the last one accepting it, which made carve-rs (which
 * refuses) look like the outlier when it was the only engine matching the
 * grammar (carve#532).
 */
describe('the separator after a definition-term marker', () => {
  it('is a space, so a tab leaves ordinary paragraph text', () => {
    const html = carveToHtml('::\tterm\n:  d\n')
    expect(html).not.toContain('<dl>')
    expect(html).toContain('<p>')
  })

  it('still opens a definition list with a space', () => {
    expect(carveToHtml(':: term\n:  d\n')).toContain('<dt>term</dt>')
  })

  it('accepts more than one space, which is content the term drops', () => {
    expect(carveToHtml(':::  term\n:  d\n')).not.toContain('<dt>term</dt>')
    expect(carveToHtml('::  term\n:  d\n')).toContain('<dt>term</dt>')
  })

  it('refuses a tab inside a list item too, where the same regex decides', () => {
    // The marker-line and nesting paths test the same expression; a fix that
    // only reached the top level would leave the tab opening a list here.
    const html = carveToHtml('- item\n\n  ::\tterm\n  :  d\n')
    expect(html).not.toContain('<dl>')
  })
})
