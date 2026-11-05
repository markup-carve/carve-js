import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

describe('collected footnote positions across host-owned comments', () => {
  it('keeps the span when the comment belongs to the containing list', () => {
    const source = '- [^n]: t\n  %%\n\n    ~~~\n    e\n]'
    const footnote = toAstJson(parse(source)).children.find((node) => node.type === 'footnote')
    expect(footnote?.pos).toEqual({
      startLine: 1, endLine: 5, startColumn: 3, endColumn: 6,
      startOffset: 2, endOffset: 29,
    })
  })

  it('omits the span when a document comment splits the definition', () => {
    const source = '[^a]: intro\n%% c\n more\n\nsee[^a]\n'
    const footnote = toAstJson(parse(source)).children.find((node) => node.type === 'footnote')
    expect(footnote?.pos).toBeUndefined()
  })
})
