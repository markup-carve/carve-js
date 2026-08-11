import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// A block that renders to nothing - a comment, an abbreviation definition, a
// non-HTML raw block - contributes no line to its parent's body. The list item
// did this already; the containers joined the empty string in and left a blank
// line where the block stood. carve-php is the oracle here.
describe('a block that renders to nothing contributes no line', () => {
  it('a comment block inside a div', () => {
    expect(h(':::\n%%%\nx\n%%%\nbody\n:::')).toBe(
      ['<div>', '  <p>body</p>', '</div>'].join('\n'),
    )
  })

  it('a comment block inside an admonition', () => {
    expect(h('::: note\n%%%\nx\n%%%\nbody\n:::')).toBe(
      ['<aside class="admonition note">', '  <p>body</p>', '</aside>'].join('\n'),
    )
  })

  it('a comment block inside a block quote', () => {
    expect(h("> q\n>\n> %%%\n> x\n> %%%\n>\n> body\n")).toBe(
      ['<blockquote>', '  <p>q</p>', '  <p>body</p>', '</blockquote>'].join('\n'),
    )
  })

  it('a comment block inside a definition body', () => {
    expect(h(':: t\n:  body\n\n   %%%\n   x\n   %%%')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', '    <p>body</p>', '  </dd>', '</dl>'].join('\n'),
    )
  })

  it('a definition body that renders to nothing closes on its own line', () => {
    expect(h(':: t\n:  %%%\n   x\n   %%%')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd></dd>', '</dl>'].join('\n'),
    )
  })

  it('a line comment inside a div', () => {
    expect(h(':::\n%% note to self\nbody\n:::')).toBe(
      ['<div>', '  <p>body</p>', '</div>'].join('\n'),
    )
  })

  it('an abbreviation definition at document level', () => {
    // Only at document level is it a definition, and only there does it render
    // to nothing. Inside the div the same line is paragraph text, so it is not
    // an empty block at all (PART 12 §7).
    expect(h('*[HTML]: HyperText Markup Language\n\n:::\nbody\n:::')).toBe(
      ['<div>', '  <p>body</p>', '</div>'].join('\n'),
    )
  })

  // A container whose body renders to nothing keeps the output a childless
  // container has - the empty line inside an aside or a block quote is what
  // every engine already emitted for `::: note` / `>` with no content, and
  // this change must not move it.
  it('a container holding only an empty block renders like an empty one', () => {
    expect(h(':::\n%%%\nx\n%%%\n:::')).toBe(h(':::\n:::'))
    expect(h('::: note\n%%%\nx\n%%%\n:::')).toBe(h('::: note\n:::'))
    expect(h('> %%%\n> x\n> %%%')).toBe(h('>'))
  })
})
