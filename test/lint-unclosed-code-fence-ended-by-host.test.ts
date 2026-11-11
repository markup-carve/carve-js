import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const fences = (source: string): string[] =>
  lintCarve(source).filter(w => w.rule === 'unclosed-code-fence').map(w => `${w.line}:${w.column}`)

describe('unclosed-code-fence when the host ends the fence', () => {
  // carve#5951: the item collector hands the fence a closer where the refused `+` stands.
  it.each([
    ['627-4', '- ```\n  x\n+\n\ntail\n', ['1:3']],
    ['627', '- ```\n+\n  x\n', ['1:3']],
    ['1036', '- - ```\n  +\n\n    x\n', ['1:5']],
    ['1016 note', '[^a]: +\n- li\n  ```\n+\n  p\n\nsee[^a]\n', ['3:3']],
    ['782-11', '- a\n  - b\n  +\n  {.x}\n  ```\n code\n  ```\n', ['5:3', '7:3']],
  ])('reports the fence a refused plus or the container ends: %s', (_row, source, expected) => {
    expect(fences(source)).toEqual(expected)
  })

  it('names the continuation marker that ends the fence', () => {
    const [finding] = lintCarve('- ```\n  x\n+\n\ntail\n').filter(w => w.rule === 'unclosed-code-fence')
    expect(finding!.message).toContain('a continuation marker on line 3 ends it')
  })

  // carve-js#4942: measuring the attached block must not report in the probe's own lines.
  it.each([
    ['996', '- +\n```\n- z\n\nq\n', ['2:1']],
    ['1016', ':: t\n: p\n+\n```\ncode\n\n  tail\n\nx\n', ['4:1']],
    ['1024', ':: t\n: +\n```\na\n\n   ```\nzz\n', ['3:1', '6:4']],
    ['974-3', '[^1]: +\n```\na\n\n  ```\n  c\n[^1]\n', ['2:1', '5:3']],
  ])('reports an attached fence once, at its opener: %s', (_row, source, expected) => {
    expect(fences(source)).toEqual(expected)
  })

  it('keeps an authored closer in a container closing the fence', () => {
    expect(fences('- ```\n  x\n  ```\n+\n\ntail\n')).toEqual([])
    expect(fences('> - ```\n>   x\n>   ```\n')).toEqual([])
  })
})
