import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Symmetric list interruption (grammar PART 9 §10).
 *
 * A list marker never interrupts an open paragraph: a bullet (`- `/`* `) and a
 * task marker need a blank line before them, exactly like an ordered marker
 * (`1.`/`a.`/`i.`) already did. Without the blank line the marker folds into the
 * open paragraph as lazy continuation.
 *
 * A heading or a quoted paragraph behaves differently (Option D, matches djot):
 * a list marker ENDS the open heading or quote and starts a top-level sibling
 * list (it does not fold in). Bullet and ordered behave identically there.
 *
 * Tight nested lists are unaffected: an indented marker that reaches the parent
 * item's content column opens a sublist with no blank line (§24). A marker BELOW
 * the content column folds.
 */
describe('symmetric list interruption (§10)', () => {
  it('a bullet does not interrupt prose (folds, no blank line)', () => {
    expect(h('intro\n- a')).toBe('<p>intro\n- a</p>')
  })

  it('an ordered marker does not interrupt prose either (unchanged)', () => {
    expect(h('intro\n1. a')).toBe('<p>intro\n1. a</p>')
  })

  it('a blank line starts the list, bullet and ordered alike', () => {
    expect(h('intro\n\n- a')).toBe('<p>intro</p>\n<ul>\n  <li>a</li>\n</ul>')
    expect(h('intro\n\n1. a')).toBe('<p>intro</p>\n<ol>\n  <li>a</li>\n</ol>')
  })

  it('a thematic break still interrupts (not a list marker)', () => {
    expect(h('intro\n---\nmore')).toBe('<p>intro</p>\n<hr>\n<p>more</p>')
  })

  it('a bullet ends an open heading and starts a sibling list, like an ordered marker', () => {
    expect(h('# T\n- item')).toBe(
      '<section id="t">\n  <h1>T</h1>\n  <ul>\n    <li>item</li>\n  </ul>\n</section>',
    )
  })

  it('a bullet ends a quoted paragraph and starts a sibling list', () => {
    expect(h('> quoted\n- item')).toBe(
      '<blockquote><p>quoted</p></blockquote>\n<ul>\n  <li>item</li>\n</ul>',
    )
  })

  it('keeps tight unordered nesting at the content column', () => {
    expect(h('- a\n  - tight\n- list')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>tight</li>\n    </ul>\n  </li>\n  <li>list</li>\n</ul>',
    )
  })

  it('keeps tight ordered nesting', () => {
    expect(h('1. a\n   2. inner\n2. list')).toBe(
      '<ol>\n  <li>a\n    <ol start="2">\n      <li>inner</li>\n    </ol>\n  </li>\n  <li>list</li>\n</ol>',
    )
  })

  it('keeps mixed nesting (bullet outer, ordered inner)', () => {
    expect(h('- a\n  1. one\n  2. two\n- b')).toBe(
      '<ul>\n  <li>a\n    <ol>\n      <li>one</li>\n      <li>two</li>\n    </ol>\n  </li>\n  <li>b</li>\n</ul>',
    )
  })

  it('folds a bullet that is below the content column (one space)', () => {
    expect(h('- a\n - b')).toBe('<ul>\n  <li>a\n- b</li>\n</ul>')
  })

  it('keeps abutting-attr sublist nesting at the content column', () => {
    expect(h('- outer\n  -{.sub} nested')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li class="sub">nested</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  // Rule B (§24): a bullet opens a list at ANY indentation, so a list that
  // starts indented and a marker that dedents below its base column are at
  // DIFFERENT base columns and therefore form two sibling lists (not nesting,
  // and not lazy text).
  it('a marker dedenting below an indented list base starts a sibling list', () => {
    expect(h('  - a\n  - b\n- c')).toBe(
      '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<ul>\n  <li>c</li>\n</ul>',
    )
  })
})
