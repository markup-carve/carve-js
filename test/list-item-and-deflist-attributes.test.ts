import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * List-item attributes (Carve addition, grammar `item_attributes`): an
 * attribute block ABUTTING the marker (no space before `{`) attaches its
 * attributes to the `<li>`. A space before the brace makes it ordinary
 * content, not a li-attribute. This is the only way to attribute a `<li>`.
 */
describe('list-item attributes', () => {
  it('attaches an abutting block to an unordered <li>', () => {
    expect(h('-{.highlight} text')).toBe(
      '<ul>\n  <li class="highlight">text</li>\n</ul>',
    )
  })

  it('attaches to an ordered <li>, applying id and key', () => {
    expect(h('1.{#first .lead} text')).toBe(
      '<ol>\n  <li id="first" class="lead">text</li>\n</ol>',
    )
  })

  it('attributes only the targeted item, not its siblings', () => {
    expect(h('- plain\n-{.last} tagged')).toBe(
      '<ul>\n  <li>plain</li>\n  <li class="last">tagged</li>\n</ul>',
    )
  })

  it('treats a space before the brace as literal content (no li-attr)', () => {
    expect(h('- {.c} text')).toBe('<ul>\n  <li>{.c} text</li>\n</ul>')
  })

  it('accepts the blessed empty block as a bare <li>', () => {
    expect(h('-{} text')).toBe('<ul>\n  <li>text</li>\n</ul>')
  })

  it('rejects an invalid payload: `-{` is not a marker', () => {
    expect(h('-{?} text')).toBe('<p>-{?} text</p>')
  })

  it('attaches to a task item, abutting the marker before the checkbox', () => {
    expect(h('-{.c} [ ] task')).toBe(
      '<ul>\n  <li class="c"><input type="checkbox" disabled> task</li>\n</ul>',
    )
  })

  it('nests a tight attributed sub-list', () => {
    expect(h('- outer\n  -{.sub} nested')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li class="sub">nested</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('folds a continuation line into an attributed item', () => {
    expect(h('-{.c} multi\n  continued')).toBe(
      '<ul>\n  <li class="c">multi\ncontinued</li>\n</ul>',
    )
  })
})

/**
 * A block-attribute line preceding a definition list floats onto the `<dl>`,
 * like any other block (grammar §15). Previously carve-js dropped it.
 */
describe('definition-list block attributes', () => {
  it('floats a preceding block-attribute line onto the <dl>', () => {
    expect(h('{.glossary}\n:: Term\n:  Definition')).toBe(
      '<dl class="glossary">\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>',
    )
  })

  it('applies id and key to the <dl>', () => {
    expect(h('{#terms data-k=v}\n:: T\n:  D')).toBe(
      '<dl id="terms" data-k="v">\n  <dt>T</dt>\n  <dd>D</dd>\n</dl>',
    )
  })
})
