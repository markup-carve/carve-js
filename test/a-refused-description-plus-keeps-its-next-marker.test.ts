import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads plus-prefixed text after a refused description marker as the next description paragraph (carve-js#4783)', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n+ sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <p>+ sib</p>\n  </dd>\n</dl>')
})

it('keeps body-column text after a refused description marker', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n  + sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <p>+ sib</p>\n  </dd>\n</dl>')
})

it('hands a root list after the refused marker text back to the document', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n+ sib\n- other\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <p>+ sib</p>\n  </dd>\n</dl>\n<ul>\n  <li>other</li>\n</ul>')
})

it('opens a body-column heading after a refused description marker', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n  # h\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <h1 id="h">h</h1>\n  </dd>\n</dl>')
})

it('keeps the complete body-column fence under the description after a refused marker', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n  ```\n  code\n  ```\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <pre><code>code\n</code></pre>\n  </dd>\n</dl>')
})

it('keeps the complete colon container under the description after a refused marker', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n  ::: note\n  body\n  :::\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </dd>\n</dl>')
})

it.each([0, 2])('keeps a bullet at column %i in the description after a refused plus (carve#5608)', (column) => {
  const source = `:: t\n: +\n1. li\n+\n${' '.repeat(column)}- sib\n`
  expect(carveToHtml(source)).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n    </ul>\n  </dd>\n</dl>')
})

it('keeps a nested marker under the retained list', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n- sib\n  - tail\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib\n        <ul>\n          <li>tail</li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>')
})

it('releases a marker between the document and description body columns', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n - sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n  </dd>\n</dl>\n<ul>\n  <li>sib</li>\n</ul>')
})

it('ends the retained description before a document heading', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n- sib\n# heading\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n    </ul>\n  </dd>\n</dl>\n<section id="heading">\n  <h1>heading</h1>\n</section>')
})

it('hands the next term to the definition list', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n- sib\n:: next\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n    </ul>\n  </dd>\n  <dt>next</dt>\n</dl>')
})

it.each(['  # h', '  > q', '  | a |', '  ```\n  code\n  ```'])('keeps a nested block inside the retained item: %s', (block) => {
  const html = carveToHtml(`:: t\n: +\n1. li\n+\n- sib\n${block}\n`)
  expect(html, block).toContain('<li>sib\n        ')
  expect(html, block).not.toContain('</ul>\n    <')
})

it.each([3, 4])('hands a different list kind at column %i back to the description', (column) => {
  expect(carveToHtml(`:: t\n: +\n1. li\n+\n${' '.repeat(column)}- sib\n`)).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n    </ul>\n  </dd>\n</dl>')
})

it('keeps a body-column sibling after the shifted marker', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n   - sib\n  - tail\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n      <li>tail</li>\n    </ul>\n  </dd>\n</dl>')
})

it('keeps a list-shaped line inside an open fence under the attached item', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n   ```\n   +\n   - code\n   ```\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li\n        <pre><code>+\n- code\n</code></pre>\n      </li>\n    </ol>\n  </dd>\n</dl>')
})

it('leaves an item-owned plus with the attached item', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n   +\n   - sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li\n+\n        <ul>\n          <li>sib</li>\n        </ul>\n      </li>\n    </ol>\n  </dd>\n</dl>')
})


