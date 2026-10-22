import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const overindented = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'list-item-block-overindented').map(w => [w.line, w.column])

describe('list-item-block-overindented measures against the innermost container', () => {
  it.each([
    ['a nested definition list after a blank', '- :: t\n  : d\n\n    :: u\n    : e\n'],
    ['a nested definition list without a blank', '- :: t\n  : d\n    :: u\n    : e\n'],
    ['a quote in a description below the item text', '- a\n\n  :: t\n  : d\n\n    > q\n'],
    ['the same shapes inside a quote', '> - :: t\n>   : d\n>\n>     :: u\n>     : e\n'],
  ])('stays silent on %s', (_, source) => {
    expect(overindented(source)).toEqual([])
  })

  it('still reports a block past the item column outside any description', () => {
    expect(overindented('- a\n\n    > q\n')).toEqual([[3, 5]])
  })
})
