import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4635: in an item, a quote's `+` attaches one block. A list after an
// attached heading, table or definition list, or a list of another marker type
// after an attached list, is the item's own list, as in the prefixed spelling.
const pairs: [string, string, string][] = [
  ['heading', '- a\n  > +\n  # h\n  - a\n\n    - r\n', '- a\n  > # h\n  - a\n\n    - r\n'],
  ['table row', '- a\n  > +\n  | a |\n  - a\n\n    - r\n', '- a\n  > | a |\n  - a\n\n    - r\n'],
  ['definition list', '- a\n  > +\n  :: t\n  : u\n  - a\n\n    > r\n', '- a\n  > :: t\n  > : u\n  - a\n\n    > r\n'],
  ['list of another marker type', '- a\n  > +\n  - t\n  * s\n\n    - r\n', '- a\n  > - t\n  * s\n\n    - r\n'],
  ['ordered list of another delimiter', '1. a\n   > +\n   1. t\n   1) s\n\n      1. r\n', '1. a\n   > 1. t\n   1) s\n\n      1. r\n'],
  ['attribute-led list', '- a\n  > +\n  {.c}\n  - t\n\n  > r\n', '- a\n  > {.c}\n  > - t\n\n  > r\n'],
]

for (const [name, plus, prefixed] of pairs) {
  it(`reads a list after an attached ${name} like the prefixed spelling`, () => {
    expect(carveToHtml(plus)).toBe(carveToHtml(prefixed))
  })
}

it('nests the follower in the list after an attached heading', () => {
  expect(carveToHtml('- a\n  > +\n  # h\n  - a\n\n    - r\n')).toBe(`<ul>
  <li>a
    <blockquote>
      <h1 id="h">h</h1>
    </blockquote>
    <ul>
      <li><p>a</p>
        <ul>
          <li>r</li>
        </ul>
      </li>
    </ul>
  </li>
</ul>`)
})
