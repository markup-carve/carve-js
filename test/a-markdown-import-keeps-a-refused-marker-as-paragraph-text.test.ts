import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

const fence = '```'
const nestedFence = `- a\n  - ${fence}\n    ${fence}\n  x\n  `

function check(source: string, expected: string, items: number): void {
  const out = markdownToCarve(source)
  expect(out).toBe(expected)
  expect(carveToCarve(out)).toBe(out)
  expect((carveToHtml(out).match(/<li\b/g) ?? []).length).toBe(items)
}

describe('Markdown list markers after an open item paragraph', () => {
  it('keeps an empty nested plus item as an item', () => {
    check('- +\n', '- - +\n', 2)
    check('> - +\n', '> - - +\n', 2)
    check('> -     +\n', '> - ```\n>   +\n>   ```\n', 1)
  })

  it('keeps a sublist adjacent to its item table', () => {
    check('- | a |\n  | - |\n  | b |\n  - x\n', '- |= a |\n  | b |\n  - x\n', 2)
  })

  it('carries a quote-first item opening from a dropped header', () => {
    check('> - |  |\n>   | --- |\n>   | a |\n', '> - | a |\n', 1)
  })

  it('keeps a nested item when a dropped table closes inside it', () => {
    check('- - |  |\n    | --- |\n  | a |\n', '- - +\n  \\| a |\n', 2)
  })

  for (const tail of ['+', '+ ', '+\t', '1.', '1)']) {
    it(`keeps ${JSON.stringify(tail)} as text after a closed nested fence`, () => {
      check(nestedFence + tail + '\n', nestedFence + tail.trimEnd() + '\n', 2)
    })
  }

  for (const tail of ['1. y', '1) y']) {
    it(`lets ${tail} interrupt the paragraph`, () => {
      check(nestedFence + tail + '\n', nestedFence.slice(0, -2) + '\n  ' + tail + '\n', 3)
    })
  }

  it('keeps a noninitial ordered marker in the paragraph', () => {
    check(nestedFence + '2. y\n', nestedFence + '2\\. y\n', 2)
  })

  it('keeps a bare bullet after a closed nested plain item', () => {
    check('- a\n  - b\n\n  x\n  +\n', '- a\n\n  - b\n\n  x\n  +\n', 2)
  })

  it('keeps a bare bullet inside a quoted item paragraph', () => {
    check('> - a\n>   x\n>   +\n', '> - a\n>   x\n>   +\n', 1)
    check('> x\n> + \n> +\n', '> x\n> +\n> +\n', 0)
    check('> x\n> +\t\n> +\n', '> x\n> +\n> +\n', 0)
  })

  it('moves a dropped quoted table header opening to its first row', () => {
    check('- > |  |\n  > | --- |\n  > | a |\n', '- > | a |\n', 1)
  })

  it('moves a dropped table header item opening to its first row', () => {
    check('- |  |\n  | --- |\n  | a |\n', '- | a |\n', 1)
  })

  it('keeps a list after a table as a list', () => {
    check('| a |\n| - |\n| b |\n2. x\n', '|= a |\n| b |\n\n2. x\n', 1)
  })

  it('carries a dropped header opening into the next quoted table header', () => {
    check('- |  |\n  | --- |\n  > | h |\n  > | --- |\n  > | a |\n', '- > |= h |\n  > | a |\n', 1)
  })

  it('keeps an existing sublist tight after item text', () => {
    check('- a\n  x\n  - y\n', '- a\n  x\n  - y\n', 2)
  })

  it('carries a dropped header into one quote level', () => {
    check('- > |  |\n  > | --- |\n  > - x\n', '- > - x\n', 2)
    check('- > > |  |\n  > > | --- |\n  > text\n', '- > text\n', 1)
  })

  it('keeps a dropped header item outside a closed quote', () => {
    check('- > |  |\n  > | --- |\n  text\n', '- text\n', 1)
  })

  it('does not move a dropped opening onto a line outside its item', () => {
    check('> - |  |\n>   | --- |\n> text\n', '> text\n', 0)
  })

  it('carries nested item openings to the first kept row', () => {
    check('- - |  |\n    | --- |\n    | a |\n', '- - | a |\n', 2)
  })

  it('does not carry a closed child list into another item', () => {
    check('- p\n  * q\n\nfoo\n\n- r\n  x\n  - y\n', '- p\n  * q\n\nfoo\n\n- r\n  x\n  - y\n', 4)
  })
})
