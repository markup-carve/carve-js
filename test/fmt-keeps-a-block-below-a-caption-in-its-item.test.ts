import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

/*
 * carve#5177: a captioned fence, quote or table opens with a line that ends
 * the paragraph above it, so the writer keeps it and the block below its
 * caption at the item's content column instead of behind a `+`.
 */

const writes = (src: string, expected: string): void => {
  const out = carveToCarve(src)
  expect(out).toBe(expected)
  expect(carveToHtml(out)).toBe(carveToHtml(src))
  expect(carveToCarve(out)).toBe(out)
}

describe('a block below a caption in a list item', () => {
  it('stays at the content column after a captioned fence (carve#5177)', () => {
    writes(
      '- text\n  ```\n  code\n  ```\n\n  ^ cap\n  > r\n',
      '- text\n  ```\n  code\n  ```\n  ^ cap\n  > r\n',
    )
  })

  it.each([
    ['a quote figure', '- text\n  > q\n  ^ cap\n  > r\n', '- text\n  > q\n  ^ cap\n  > r\n'],
    ['a math figure', '1. text\n   $$\n   x\n   $$\n   ^ cap\n   > r\n', '1. text\n   $$\n   x\n   $$\n   ^ cap\n   > r\n'],
    ['a nested fence figure', '- a\n\n  - text\n    ```\n    code\n    ```\n    ^ cap\n    > r\n',
      '- a\n\n  - text\n    ```\n    code\n    ```\n    ^ cap\n    > r\n'],
  ])('keeps %s and its follower in the item', (_name, src, expected) => writes(src, expected))

  it('keeps the + spelling when the caption ends the item (corpus 622)', () => {
    writes('- x\n  ```\n  x\n  ```\n  ^ cap\n- c\n', '- x\n+\n```\nx\n```\n^ cap\n- c\n')
  })

  it.each([
    ['a caption that runs on', '- text\n  ```\n  code\n  ```\n  ^ cap\n  more\n', '- text\n  ```\n  code\n  ```\n  ^ cap\n  more\n'],
    ['a figure below a figure', '- a\n\n  - text\n    ```\n    x\n    ```\n    ^ cap\n    ```\n    y\n    ```\n    ^ cap2\n',
      '- a\n\n  - text\n    ```\n    x\n    ```\n    ^ cap\n    ```\n    y\n    ```\n    ^ cap2\n'],
  ])('writes no + for %s', (_name, src, expected) => writes(src, expected))

  it('does not merge a captioned table with the table below it', () => {
    writes(
      '- outer\n\n  - one\n    | a | b |\n    ^ cap\n    | t |\n',
      '- outer\n\n  - one\n    | a | b |\n    ^ cap\n    | t |\n',
    )
  })

  it('keeps two tables apart when the first caption is blank', () => {
    const out = htmlToCarve('<ul><li>one<table><caption></caption><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table></li></ul>').value
    expect((carveToHtml(out).match(/<table>/g) ?? []).length).toBe(2)
  })
})
