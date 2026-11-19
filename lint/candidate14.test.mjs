import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const finding = (source, code) => lint(source).find((entry) => entry.code === code)

describe('candidate 14 lint clauses', () => {
  it('C2-B-090, C2-B-119: refused attribute starts report inside every quote and item host', () => {
    const shapes = [
      ['[^q]: > {.x\n     .y}\n\nx[^q]\n', 8],
      ['[^q]: > {.x\n         .y}\n\nx[^q]\n', 8],
      ['- > {.x\n }\nplain\n', 4],
      ['- [ ] > {.x\n      .y}\nplain\n', 8],
      ['[^q]: > > {.x\n       .y}\n\nx[^q]\n', 10],
    ]
    for (const [source, byte] of shapes) {
      const reports = lint(source).filter((entry) => entry.code === 'block-marker-as-text')
      expect(reports, source).toHaveLength(1)
      expect(reports[0].range.startOffset).toBe(byte)
    }
  })

  it('C2-B-125: a short bare colon run chooses its actual closing outcome and container kind', () => {
    expect(finding(':::: note\n:::\n', 'colon-fence-length-mismatch')?.message)
      .toContain('4-colon admonition')
    expect(finding(':::: note\n::::: warning\n::::\n', 'colon-fence-length-mismatch')?.message)
      .toContain('closes an enclosing container and every container inside it')
    expect(finding(':::: figure\n:::\n', 'colon-fence-length-mismatch')?.message)
      .toContain('4-colon figure group')
  })

  it('C2-B-173: a blocked span mark uses the reason of its table position', () => {
    expect(finding('| < |\n', 'table-span-marker-blocked')?.message).toContain('no cell to its left')
    expect(finding('|a|<|\n|^|b|\n', 'table-span-marker-blocked')?.message)
      .toContain('cell above it spans more than one column')
  })

  it('C2-B-019, C2-B-200: a valid attribute line does not warn about its heading', () => {
    expect(finding('{#care}\n# Care guide\n', 'block-opener-without-blank-line')).toBeUndefined()
    expect(finding('- a\n# H\n', 'block-opener-without-blank-line')?.range)
      .toEqual({ startOffset: 4, endOffset: 5 })
  })
})
