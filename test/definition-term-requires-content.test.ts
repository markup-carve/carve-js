import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 9's MARKER REQUIRES CONTENT covers every marker that takes a separator
 * space, including the definition-term marker `::`.
 *
 * `::` and `:: ` were already paragraphs here. `::` plus a SECOND space was
 * not: it produced `<dl><dt> </dt></dl>`, with the space itself as the term. So
 * deleting one invisible character changed the document's structure - the exact
 * thing the rule's own rationale exists to prevent, since editors strip trailing
 * whitespace on save and `git apply --whitespace=fix` strips it too.
 *
 * The three engines carried three answers for it: carve-js a term holding a
 * space, carve-php an empty term, carve-rs a paragraph. carve-rs was right
 * (carve#512).
 */
describe('a content-less :: is paragraph text (PART 9 MARKER REQUIRES CONTENT)', () => {
  it.each([
    ['bare', '::\n'],
    ['one trailing space', ':: \n'],
    ['two trailing spaces', '::  \n'],
    ['many trailing spaces', '::     \n'],
    ['a trailing tab', '::\t\n'],
    ['a space then a tab', ':: \t\n'],
  ])('%s is a paragraph', (_label, src) => {
    const html = carveToHtml(src)
    expect(html).not.toContain('<dl>')
    expect(html).toContain('<p>::</p>')
  })

  it('a term with real content still opens a definition list', () => {
    expect(carveToHtml(':: t\n')).toContain('<dt>t</dt>')
  })

  it('a tab separator still works', () => {
    expect(carveToHtml('::\tt\n')).toContain('<dt>t</dt>')
  })

  it('a full term and definition still work', () => {
    const html = carveToHtml(':: a\n:  b\n')
    expect(html).toContain('<dt>a</dt>')
    expect(html).toContain('<dd>b</dd>')
  })
})
