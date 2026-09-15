import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToCarve, parse } from '../src/index.js'

/**
 * A tight item continues a block at its MARKER column behind a `+` (PART 9
 * §17 L3), and the writer tags the lines that belong there. `renderList` took
 * the tag back off every CONTINUATION line and never off the item's FIRST one,
 * so an item whose first child is written at the marker column shipped a
 * literal U+E006:
 *
 *     - > q
 *
 *       > b
 *     Z
 *
 * came out as `- <U+E006>+`, which re-parses as an item holding that character
 * and leaves both quotes at the document level, the second one swallowing `Z`.
 *
 * The second shape is the other side of the same column: the sub-list's marker
 * column IS the hosting item's content column, and an EMPTY last item's `+`
 * claims it, so a `>` written there opens inside that item instead.
 *
 * Both change the HTML, so unlike carve-js#1676 a render comparison can see
 * them - but the tree and the fixpoint are pinned too, because the general
 * class is invisible to HTML (carve-js#1681).
 */

const NO_SENTINEL = /[\ue000-\uf8ff]/

const cases: Array<[string, string, string]> = [
  ['a quote below a quote, bullet item', '- > q\n\n  > b\nZ\n', '- +\n> q\n+\n> b\n> Z\n'],
  ['a quote below a quote, ordered item', '1. > q\n\n   > b\nZ\n', '1. +\n> q\n+\n> b\n> Z\n'],
  [
    'a quote below a quote, item in a blockquote',
    '> - > q\n>\n>   > b\n> Z\n',
    '> - +\n> > q\n> +\n> > b\n> > Z\n',
  ],
  [
    'a quote below a quote, item in a div',
    '::: h\n- > q\n\n  > b\nZ\n:::\n',
    '::: h\n- +\n> q\n+\n> b\n> Z\n:::\n',
  ],
  [
    'a quote below a quote whose only child is a heading',
    '- > ## H\n\n  > b\nZ\n',
    '- +\n> ## H\n+\n> b\n> Z\n',
  ],
  [
    'a quote below a quote whose only child is a heading, item in a div',
    '::: h\n- > ## H\n\n  > b\nZ\n:::\n',
    '::: h\n- +\n> ## H\n+\n> b\n> Z\n:::\n',
  ],
  [
    'a table below a table',
    '- | a |\n  | - |\n\n  | a |\n  | - |\nZ\n',
    '- +\n|= a |\n+\n|= a |\n\nZ\n',
  ],
  [
    'a table below a table, item in a div',
    '::: h\n- | a |\n  | - |\n\n  | a |\n  | - |\nZ\n:::\n',
    '::: h\n- +\n|= a |\n+\n|= a |\n\nZ\n:::\n',
  ],
  [
    'a quote below an emptied sub-list item',
    '- - +\n\n  > b\nZ\n',
    '- - +\n\n  > b\n  > Z\n',
  ],
  [
    'a quote below an emptied sub-list item, ordered host',
    '1. - +\n\n   > b\nZ\n',
    '1. - +\n\n   > b\n   > Z\n',
  ],
  [
    'a quote below an emptied sub-list item, item in a div',
    '::: h\n- - +\n\n  > b\nZ\n:::\n',
    '::: h\n- - +\n\n  > b\n  > Z\n:::\n',
  ],
]

describe('a block continued inside a tight item', () => {
  for (const [name, source, written] of cases) {
    it(`writes ${name} so it stays in the item`, () => {
      expect(carveToCarve(source)).toBe(written)
    })

    it(`keeps the HTML of ${name}`, () => {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })

    it(`keeps the tree of ${name}`, () => {
      expect(shape(carveToCarve(source))).toEqual(shape(source))
    })

    it(`reaches a fixpoint on ${name}`, () => {
      const once = carveToCarve(source)
      expect(carveToCarve(once)).toBe(once)
    })

    it(`ships no writer sentinel for ${name}`, () => {
      expect([name, NO_SENTINEL.test(carveToCarve(source))]).toEqual([name, false])
    })
  }
})

/**
 * The spellings this fix must NOT move.
 *
 * They stay green whether the fix is present or not, so they are the regression
 * surface and never evidence: corpus 285 pins the marker-column form as the
 * canonical one for an item that opens with a paragraph, and the last row is the
 * reason the emptied-item arm is bounded to a quote - a blank line there would
 * part the paragraph and turn a tight item loose.
 */
describe('the spellings the fix leaves alone', () => {
  const controls: Array<[string, string, string]> = [
    ['corpus 285, a marker-column run below a paragraph', '- x\n+\n> q\n+\n> q\n', '- x\n+\n> q\n+\n> q\n'],
    ['a sub-list whose last item is not empty', '- - +\n  x\n\n  > b\nZ\n', '- - +\n  x\n  > b\n  > Z\n'],
    ['a heading below an emptied sub-list item', '- - +\n\n  # H\nZ\n', '- - +\n  # H\n\nZ\n'],
    ['a paragraph below an emptied sub-list item', '- - +\n\n  p\nZ\n', '- - +\n\n  p\n  Z\n'],
  ]

  for (const [name, source, written] of controls) {
    it(`leaves ${name} as it is`, () => {
      expect(carveToCarve(source)).toBe(written)
    })
  }

  it('keeps the item tight when a paragraph follows an emptied sub-list item', () => {
    expect(carveToHtml(carveToCarve('- - +\n\n  p\nZ\n'))).toBe(carveToHtml('- - +\n\n  p\nZ\n'))
  })
})

/** The tree without the source positions a re-spelling necessarily moves. */
function shape(source: string): unknown {
  const positional = /Spans$|Lines$|^pos$|^sourcePos$|^srcByteLength$/
  return JSON.parse(JSON.stringify(parse(source), (k, v) => (positional.test(k) ? undefined : v)))
}
