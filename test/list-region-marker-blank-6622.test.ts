import { describe, expect, it } from 'vitest'
import { type DocumentNode, format, parse, render } from '../src/index.ts'

function withoutPositions(document: DocumentNode): string {
  return JSON.stringify(document.children, (key, value: unknown) => (key === 'pos' ? undefined : value))
}

describe('carve#6622: a blank line before a region marker inside an item', () => {
  it('C2-B-062, C2-B-137: the blank line stands inside the item, so the list stays tight', () => {
    const source = '- e\n\n  %% #endregion ps\n- two\n'
    expect(parse(source).children[0]).toMatchObject({ type: 'list', spacing: 'tight' })
    expect(render(source)).toBe('<ul>\n  <li>e</li>\n  <li>two</li>\n</ul>')
  })

  it('C2-W-034: fmt of the tight list keeps its tree', () => {
    const source = '- e\n  %% #endregion ps\n- two\n'
    expect(format(source)).toBe('- e\n\n  %% #endregion ps\n- two\n')
    expect(withoutPositions(parse(format(source)))).toBe(withoutPositions(parse(source)))
  })

  it('C2-B-137: a plain comment line adds nothing to the blank lines, so the list is loose', () => {
    expect(parse('- e\n\n  %% note\n- two\n').children[0]).toMatchObject({ type: 'list', spacing: 'loose' })
  })

  it('C2-B-062: a blank line after the marker still stands between the items', () => {
    expect(parse('- e\n  %% #endregion ps\n\n- two\n').children[0]).toMatchObject({ type: 'list', spacing: 'loose' })
  })
})
