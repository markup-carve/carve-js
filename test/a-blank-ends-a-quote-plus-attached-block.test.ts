import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5383: the block a quote's `+` attaches is the quote's, so the blank that
// ends the quote ends it too. Each `+` spelling reads like its prefixed spelling.
const pairs: [string, string, string][] = [
  ['list at the top level', '> +\n- t\n\n  > r\n', '> - t\n\n  > r\n'],
  ['definition list at the top level', '> +\n:: t\n: u\n\n  # r\n', '> :: t\n> : u\n\n  # r\n'],
  ['ordered list under a quote', '> > +\n> 1. t\n>\n>    r\n', '> > 1. t\n>\n>    r\n'],
  ['list in a nested item', '- a\n  - b\n    > +\n    - t\n\n      > r\n', '- a\n  - b\n    > - t\n\n      > r\n'],
  ['list after two blanks', '> +\n- t\n- s\n\n\n  # r\n', '> - t\n> - s\n\n\n  # r\n'],
]

for (const [name, plus, prefixed] of pairs) {
  it(`ends the attached ${name} at the blank`, () => {
    expect(carveToHtml(plus)).toBe(carveToHtml(prefixed))
  })
}

it('opens a document-level quote after the attached list', () => {
  expect(carveToHtml('> +\n- t\n\n  > r\n')).toBe(`<blockquote>
  <ul>
    <li>t</li>
  </ul>
</blockquote>
<blockquote><p>r</p></blockquote>`)
})

it('keeps a closed attached fence open across its blank', () => {
  expect(carveToHtml('> +\n```\na\n\n  b\n```\n')).toContain('<pre><code>a\n\n  b\n</code></pre>')
})

it('keeps a list after an attached heading open across its blank', () => {
  expect(carveToHtml('> +\n# h\n- a\n\n  > r\n')).toBe(carveToHtml('> # h\n- a\n\n  > r\n'))
})

it('ends a list after an attribute line the quote attached', () => {
  expect(carveToHtml('> +\n{.c}\n- t\n\n  > r\n')).toBe(carveToHtml('> {.c}\n> - t\n\n  > r\n'))
})
