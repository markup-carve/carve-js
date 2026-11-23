import { describe, expect, it } from 'vitest'
import { parse, writeWithDiagnostics } from '../src/index.ts'
import { checkWriter } from './support/writer-checks.ts'

describe('C2-W-123, C2-B-137: a comment after an item that ends with a fence inside a colon container', () => {
  it('writes CC-1760 with the fence and the line block left open', () => {
    const written = writeWithDiagnostics(parse('- x\n  - ::: |\n    %%%\n%% c\n    %%%\nz'))
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe('- x\n  - ::: |\n    %%%\n  %% c\n  %%%\n  %%%\n\nz\n')
  })

  it('keeps the tree for each colon container, fence and host', () => {
    const sources = [
      '- x\n  - ::: note\n    ```\n    b\n%% c\n  y',
      '- x\n  - :::: box\n    ::: |\n    %%%\n%% c',
      '- x\n  - ::: box\n    - a\n      ~~~\n%% c\nz',
      ':: t\n: ::: warning\n  %%%\n%% c',
      '[^n]: x\n  - ::: |\n    ```=html\n%% c',
    ]
    for (const source of sources) expect(checkWriter(source), source).toBeNull()
  })

  it('closes a captioned fence, whose caption line would read as code', () => {
    for (const source of ['- ::: box\n  ```\n  x\n  ```\n  ^ cap\n  :::\n', '- ```\n  x\n  ```\n  ^ cap\n']) {
      const tree = parse(source)
      tree.children.push(parse('%% c\n').children[0]!)
      const written = writeWithDiagnostics(tree)
      expect(written.source, source).toContain('  ```\n  ^ cap\n')
      expect(written.diagnostics.map((entry) => entry.code), source).toEqual(['structure-unspellable'])
    }
  })
})
