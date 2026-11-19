// The maintainer rulings of carve#6175, #6176, #6177 and #6178 (19 November).
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { citations } from '../src/extensions/citations.ts'
import { glossary } from '../src/extensions/glossary.ts'

const extensions = [...citations().extensions, ...glossary().extensions]
const lineColumn = (source, offset) => {
  const before = source.slice(0, offset).split('\n')
  return [before.length, before.at(-1).length + 1]
}
const found = (source, code, options = {}) => lint(source, options).filter((entry) => entry.code === code)
  .map((entry) => lineColumn(source, entry.range.startOffset))

describe('lint rulings', () => {
  it('carve#6175: a directive is an open colon container for colon-fence-length-mismatch', () => {
    for (const options of [{}, { extensions }]) {
      expect(found(':::: references\n:::\n', 'colon-fence-length-mismatch', options)).toEqual([[2, 1]])
      expect(found('::::\n::: glossary\n:::\n::::\n', 'colon-fence-length-mismatch', options)).toEqual([])
    }
    const [entry] = lint('::::\n::: toc\n::\n::::: \n').filter((d) => d.code === 'colon-fence-length-mismatch')
    expect(entry?.message).toContain('innermost 3-colon div opened at 2:1')
  })

  it('carve#6176: unattached-inline-attribute reads headings, terms, descriptions and table cells', () => {
    expect(found('# x {#id} y\n', 'unattached-inline-attribute')).toEqual([[1, 5]])
    expect(found(':: x {#id}\n\n: y\n', 'unattached-inline-attribute')).toEqual([[1, 6]])
    expect(found(':: t\n: x {#id} y\n', 'unattached-inline-attribute')).toEqual([[2, 5]])
    expect(found('| x {#id} y |\n', 'unattached-inline-attribute')).toEqual([[1, 5]])
    expect(found('| a | {#id} |\n', 'unattached-inline-attribute')).toEqual([])
  })

  it('carve#6178: a lazy line offers its own quote mark as the candidate', () => {
    expect(found('    i) > $$x$$\n   > ## H\n', 'block-opener-without-blank-line')).toEqual([[2, 4]])
    expect(found('10. %%#region\n     > :\n> [ ]: u\n', 'block-opener-without-blank-line')).toEqual([[3, 1]])
    expect(found('> a\n> ## H\n', 'block-opener-without-blank-line')).toEqual([[2, 3]])
    expect(found('> a\n> > b\n', 'block-opener-without-blank-line')).toEqual([])
  })

  it('carve#6177: heading-marker-mixed stands on the first heading of the document', () => {
    expect(found('Text.\n\n= A\n\n# B\n', 'heading-marker-mixed')).toEqual([[3, 1]])
    expect(found('\n= H #\n## H\n', 'heading-marker-mixed')).toEqual([[2, 1]])
    expect(found('- a\n\n  ## B\n\n= C\n', 'heading-marker-mixed')).toEqual([[3, 3]])
  })
})
