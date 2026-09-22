import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * An empty term marker is text, whether or not a space follows it: `::` and
 * `:: ` are one line under PART 2's empty-marker rule, trailing whitespace is
 * not content (CARVE-P2-025), and below a body's column only a line that opens
 * a block ends it (CARVE-P2-017). carve-js read `:: ` as a boundary and folded
 * only the bare `::` (#1891).
 *
 * Expected bytes are the executable reference's, identical at the 0.1.6 tag
 * and at spec main, where section 483 pins the description-body rows.
 */
describe('an empty term marker is text', () => {
  const body: [string, string, string][] = [
    [
      'one trailing space',
      ':: t\n: a\n:: \nc\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n::\nc</dd>\n</dl>',
    ],
    [
      'two trailing spaces',
      ':: t\n: a\n::  \nc\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n::\nc</dd>\n</dl>',
    ],
    [
      'the end of the document',
      ':: t\n: a\n:: \n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n::</dd>\n</dl>',
    ],
    [
      'after a continuation line',
      ':: t\n: a\n  b\n:: \nc\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\nb\n::\nc</dd>\n</dl>',
    ],
    [
      'before a definition',
      ':: t\n: a\n:: \n: c\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n::</dd>\n  <dd>c</dd>\n</dl>',
    ],
    [
      'inside a list item',
      '- x\n  :: t\n  : a\n  :: \n',
      '<ul>\n  <li>x\n    <dl>\n      <dt>t</dt>\n      <dd>a\n::</dd>\n    </dl>\n  </li>\n</ul>',
    ],
  ]

  for (const [name, source, expected] of body) {
    it(`folds into the description body: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  const term: [string, string, string][] = [
    [
      'in a term\'s continuation',
      ':: t\n:: \n: a\n',
      '<dl>\n  <dt>t\n::</dt>\n  <dd>a</dd>\n</dl>',
    ],
  ]

  for (const [name, source, expected] of term) {
    it(`folds into the term: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  // Rows that read the same before and after. The last is a shape control: the
  // body stops at a real term through the interruption test as well, so no
  // single change to the break reaches it.
  const unchanged: [string, string, string][] = [
    [
      'a bare marker folds into the body',
      ':: t\n: a\n::\nc\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a\n::\nc</dd>\n</dl>',
    ],
    [
      'a bare marker folds into the term',
      ':: t\n::\n: a\n',
      '<dl>\n  <dt>t\n::</dt>\n  <dd>a</dd>\n</dl>',
    ],
    [
      'an empty marker at document level is text',
      ':: \nc\n',
      '<p>::\nc</p>',
    ],
    [
      'a term after the body still opens an entry',
      ':: t\n: a\n:: u\n: c\n',
      '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n  <dt>u</dt>\n  <dd>c</dd>\n</dl>',
    ],
  ]

  for (const [name, source, expected] of unchanged) {
    it(`still reads: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  it('covers every row', () => {
    expect(body).toHaveLength(6)
    expect(term).toHaveLength(1)
    expect(unchanged).toHaveLength(4)
  })
})
