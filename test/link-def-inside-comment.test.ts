import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A comment's body is OPAQUE. This engine already applied that to footnote
 * definitions and not to link reference definitions, so a `[r]: /u` written
 * inside `%%%` registered: invisible in the output AND active in the link
 * table, which makes a reference elsewhere resolve against text the author
 * commented out (carve-js#634, markup-carve/carve#644).
 */
describe('a definition inside a comment registers nothing', () => {
  it('a link reference definition does not register', () => {
    expect(carveToHtml('%%%\n[r]: /u\n%%%\n[r][]\n').trim()).toBe('<p>[r][]</p>')
  })

  it('a footnote definition still does not register', () => {
    const out = carveToHtml('%%%\n[^a]: note\n%%%\nsee[^a]\n')
    expect(out).not.toContain('doc-endnotes')
    expect(out).toContain('see[^a]')
  })

  it('an ordinary definition outside a comment still resolves', () => {
    expect(carveToHtml('[r]: /u\n\n[r][]\n')).toContain('href="/u"')
  })

  it('an unterminated fence does not suppress the rest of the document', () => {
    // An unterminated `%%%` is not a fenced comment - it degrades to a
    // single-line comment. Treating it as open would swallow every later
    // definition.
    expect(carveToHtml('%%%\n[r]: /u\n\n[r][]\n')).toContain('href="/u"')
  })
})
