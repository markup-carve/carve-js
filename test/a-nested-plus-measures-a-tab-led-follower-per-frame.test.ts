import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4976: the refusal lookahead of a nested `+` measures a tab-led line per frame (PART 9 §24 C5),
// and a line that stands at the marker column by line-start stops still holds the block.
const nested = (outer: string, inner: string, item: string): string =>
  `${outer}\n  <li>x\n    <${inner}>\n      <li>y\n        <ol>\n${item}        </ol>\n      </li>\n    </${inner}>\n  </li>\n</${outer.slice(1, 3)}>`

it('refuses the plus when a tab puts the attribute line between its columns', () => {
  for (const lead of ['    \t', '\t\t']) {
    expect(carveToHtml(`1. x\n   - y\n     1. +\n${lead}{#i}\n     q\n`)).toBe(
      '<ol>\n  <li>x\n    <ul>\n      <li>y\n        <ol>\n          <li></li>\n        </ol>\n        <p id="i">q</p>\n      </li>\n    </ul>\n  </li>\n</ol>',
    )
  }
})

it('attaches the block when a tab puts the attribute line past the content column', () => {
  for (const lead of ['     \t', '      \t']) {
    expect(carveToHtml(`1. x\n   - y\n     1. +\n${lead}{#i}\n     q\n`)).toBe(
      nested('<ol>', 'ul', '          <li><p id="i">q</p></li>\n'),
    )
  }
})

it('attaches the block when the attribute line reaches the marker column by line-start stops', () => {
  expect(carveToHtml('- x\n  - y\n    1. +\n  \t{#i}\n    q\n')).toBe(nested('<ul>', 'ul', '          <li><p id="i">q</p></li>\n'))
  expect(carveToHtml('- x\n  - y\n    1. +\n   \t{#i}\n       {#i}\n    q\n')).toBe(nested('<ul>', 'ul', '          <li><p id="i">q</p></li>\n'))
})

it('moves a tab-led attribute line past the content column inside a quote', () => {
  expect(carveToHtml('> - x\n>   1. y\n>      1. +\n>       \t{#i}\n>      q\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>x\n      <ol>\n        <li>y\n          <ol>\n            <li><p id="i">q</p></li>\n          </ol>\n        </li>\n      </ol>\n    </li>\n  </ul>\n</blockquote>',
  )
})
