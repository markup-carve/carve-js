// carve-js#5201: the authored-block fallback of C2-W-088 across a line break inside a node, as in a wrapped label.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const wrapped = '``^[/`"`[^\\\\/ \n`]^[[^*]\\`/=[^`[]]'

describe('C2-W-088: the authored slice of a node that wraps', () => {
  it('C2-W-022: writes no space at the end of the wrapped line', () => {
    for (const normalize of [false, true]) {
      const result = formatWithDiagnostics(wrapped, { normalize })
      expect(result.source).toBe('``^[/`"`[^\\\\/\n`]^[[^*]\\`/=[^`[]]\n')
      expect(result.diagnostics).toEqual([])
    }
  })

  it('C2-W-024: indents the wrapped line once inside a list item', () => {
    const once = formatWithDiagnostics(`- ${wrapped}`).source
    expect(once).toBe('- ``^[/`"`[^\\\\/\n  `]^[[^*]\\`/=[^`[]]\n')
    expect(formatWithDiagnostics(once).source).toBe(once)
  })
})
