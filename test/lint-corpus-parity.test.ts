import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

describe('lint corpus parity', () => {
  it('reports only containers that opened before the nesting cap', () => {
    const warnings = lintCarve('::: note\n'.repeat(203))
      .filter((warning) => warning.rule === 'unclosed-container-fence')
    expect(warnings).toHaveLength(200)
    expect(warnings.map((warning) => warning.line)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1))
  })

  it('reports a fence-shaped line after its item has ended', () => {
    for (const source of [
      '- a\n  ```\n  b\n y\n  ```\n',
      '- > q\n  ```\n  b\n y\n  ```\n',
      '- ![a](i)\n  ^ cap\n  ```\n  b\n y\n  ```\n',
    ]) {
      const warnings = lintCarve(source)
      expect(warnings.map((warning) => warning.rule)).toEqual(['fence-delimiter-indentation'])
      expect(warnings[0]!.line).toBe(source.split('\n').length - 1)
    }
  })

  // Corpus 581 and 581-3 (CARVE-P0-014): the `:::` sits inside the unclosed code
  // fence, so the box on line 1 never closes.
  it.each([
    ['581', '> - ::: box\n>   - ::: |\n>     ```\n>     :::\n>    ```\n>    :::bad\n>    :::\n- tail\n', ['1:5 unclosed-container-fence', '5:6 list-item-block-overindented']],
    ['581-3', '> - ::: box\n>   -   ::: |\n>       ```\n>       :::\n>     ```\n>     :::\n>     :::bad\n>     :::\n- tail\n', ['1:5 unclosed-container-fence', '5:7 list-item-block-overindented']],
  ])('reports the box a code fence swallows the closer of: %s', (_row, source, expected) => {
    expect(lintCarve(source).map((warning) => `${warning.line}:${warning.column} ${warning.rule}`).sort()).toEqual(expected)
  })
})
