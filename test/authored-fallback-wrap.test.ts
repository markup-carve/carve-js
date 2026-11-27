// C2-W-088, carve#6802: reporting all constructs can settle a wrapped node before the authored-block fallback.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const wrapped = '``^[/`"`[^\\\\/ \n`]^[[^*]\\`/=[^`[]]'

describe('C2-W-088: the round of a node with a source wrap', () => {
  it('C2-W-022: writes no trailing space when a code span becomes one line', () => {
    for (const normalize of [false, true]) {
      const result = formatWithDiagnostics(wrapped, { normalize })
      expect(result.source).toBe("\\`\\`^\\[/`\"`[^\\\\/ `]^\\[\\[^*]\\`/=\\[^\\`\\[\\]]\n")
      expect(result.diagnostics).toEqual([])
    }
  })

  it('C2-W-024: keeps the item marker when a code span becomes one line', () => {
    const once = formatWithDiagnostics(`- ${wrapped}`).source
    expect(once).toBe("- \\`\\`^\\[/`\"`[^\\\\/ `]^\\[\\[^*]\\`/=\\[^\\`\\[\\]]\n")
    expect(formatWithDiagnostics(once).source).toBe(once)
  })

  it('C2-W-024: keeps container marks and writes the remaining lazy lines', () => {
    for (const [input, expected] of [
      [`> > ${wrapped.replace('\n', '\n> > ')}`, "> > \\`\\`^\\[/`\"`[^\\\\/ `]^\\[\\[^*]\\`/=\\[^\\`\\[\\]]\n"],
      ['- > ``^[/`"`[^\\\\/\n  > `]^[[^*]\\`/=[^`[]]\n', "- > \\`\\`^\\[/`\"`[^\\\\/ `]^\\[\\[^*]\\`/=\\[^\\`\\[\\]]\n"],
      [' > ^[/\\[^}[^}]*\\][^[\n> ]/', '> ^[/\\[^}[^}]*\\][^[\n> ]/\n'],
      ['> :n[\n{[]``\n> ``@\\`~]`', '> :n[\n> {[]``\n> ``@\\`~]`\n'],
      // A code span line whose content starts with a quote marker keeps it on both runs.
      ['> `\n> >`*[\n|*[^\n{]|', '> `\n> >`*[\n> |*[^\n> {]|\n'],
    ]) {
      const result = formatWithDiagnostics(input!)
      expect(result.source, input).toBe(expected)
      expect(result.diagnostics, input).toEqual([])
      expect(formatWithDiagnostics(result.source).source, input).toBe(expected)
    }
  })
})
