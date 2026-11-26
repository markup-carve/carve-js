import { describe, expect, it } from 'vitest'
import { type DocumentNode, formatWithDiagnostics, parse, writeWithDiagnostics } from '../src/index.ts'

function withoutPositions(document: DocumentNode): string {
  return JSON.stringify(document.children, (key, value: unknown) => (key === 'pos' ? undefined : value))
}

function formatted(source: string): string {
  const { source: out, diagnostics } = formatWithDiagnostics(source)
  expect(diagnostics).toEqual([])
  expect(withoutPositions(parse(out)), out).toBe(withoutPositions(parse(source)))
  expect(formatWithDiagnostics(out).source).toBe(out)
  return out
}

describe('carve#6727: a region marker keeps the closer of the fence above it (C2-W-123, C2-W-034)', () => {
  it('a list, a description list and a footnote whose last block is a fence', () => {
    expect(formatted('- a\n  ```\n  x\n  ```\n%% #endregion\n')).toBe('- a\n\n  ```\n  x\n  ```\n\n%% #endregion\n')
    expect(formatted(':: t\n: ```\n  x\n  ```\n%% #region r\n')).toBe(':: t\n: ```\n  x\n  ```\n\n%% #region r\n')
    expect(formatted('[^n]: a\n  ```\n  x\n  ```\n%% #endregion\n\n[^n]\n'))
      .toBe('[^n]: a\n\n  ```\n  x\n  ```\n\n%% #endregion\n\n[^n]\n')
  })

  it('a comment block and a fence inside a div at the end of the item', () => {
    expect(formatted('- a\n  %%%\n  x\n  %%%\n%% #endregion\n')).toBe('- a\n\n  %%%\n  x\n  %%%\n\n%% #endregion\n')
    expect(formatted('- a\n  ::: d\n  ```\n  x\n  ```\n  :::\n%% #endregion\n'))
      .toBe('- a\n\n  ::: d\n  ```\n  x\n  ```\n  :::\n\n%% #endregion\n')
  })

  it('a supplied fence whose value ends in an empty line keeps it before a region marker, with no loss', () => {
    const tree: DocumentNode = { type: 'document', astVersion: '2.0', children: [
      { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [{ type: 'list_item', children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'a' }] }, { type: 'code_block', value: 'x\n\n' }] }] },
      { type: 'comment', form: 'line', value: '#endregion' }] }
    const { source, diagnostics } = writeWithDiagnostics(tree)
    expect(source).toBe('- a\n\n  ```\n  x\n\n  ```\n\n%% #endregion\n')
    expect(diagnostics).toEqual([])
  })

  it('a line comment other than a region marker still ends the open fence (C2-W-123)', () => {
    const source = '- a\n  ```\n  x\n%% c\n'
    const out = formatWithDiagnostics(source).source
    expect(out).toBe('- a\n\n  ```\n  x\n%% c\n')
    expect(withoutPositions(parse(out))).toBe(withoutPositions(parse(source)))
  })
})
