import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const newCorpus = [
  '1025-an-item-own-line-plus-fence-keeps-its-trailing-blank',
  '1026-a-description-plus-after-a-blank-reaches-its-host',
  '1027-a-note-plus-after-a-blank-reaches-its-host',
  '1028-an-own-line-plus-fence-keeps-a-quote-blank',
  '1029-a-quoted-note-run-uses-the-lazy-line-written-column',
  '1030-a-refused-brace-run-keeps-a-following-plus-literal',
  '1031-an-own-line-plus-fence-ends-before-a-shifted-run',
]

for (const name of newCorpus) {
  it(`renders pinned corpus row ${name}`, () => {
    const source = readFileSync(new URL(`../spec/tests/corpus/${name}.crv`, import.meta.url), 'utf8')
    const expected = readFileSync(new URL(`../spec/tests/corpus/${name}.html`, import.meta.url), 'utf8').trimEnd()
    expect(carveToHtml(source).trimEnd()).toBe(expected)
  })
}

it('hands a wrapped attribute and shifted fence to a description parent', () => {
  expect(carveToHtml('- :: t\n  : +\n  {#i\n   .y}\n   ```\n    zq')).toBe(
    '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd></dd>\n    </dl>\n    <pre id="i" class="y"><code> zq</code></pre>\n  </li>\n</ul>',
  )
})

it('returns an unprefixed line after a stacked quote attribute to the document', () => {
  expect(carveToHtml('- > +\n  `o\n  {#i\n   .y}\nzq')).toBe(
    '<ul>\n  <li>\n    <blockquote><p><code>o\n{#i\n.y}</code></p></blockquote>\n  </li>\n</ul>\n<p>zq</p>',
  )
})

// An unclosed `{%` is text and holds no brace line (carve#5740, option B).
it('ends the paragraph at a block-shaped attribute after an unclosed inline comment opener', () => {
  expect(carveToHtml('{%%%:fr}\n*y*{k="a\tb"}\n{lang=de}\n')).toBe(
    '<p>{%%%:fr}\n<strong k="a\tb">y</strong></p>',
  )
})
