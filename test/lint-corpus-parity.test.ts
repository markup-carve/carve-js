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
})
