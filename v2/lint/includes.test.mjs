// Lint through includes (C2-N-085 to C2-N-088).
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const resolver = (files) => (request) => Object.hasOwn(files, request.path)
  ? { text: files[request.path], id: request.path } : { error: 'not_found' }

describe('lint and includes', () => {
  it('C2-N-085: without a resolver no include target is read', () => {
    expect(lint('{{ child.crv }}').filter((entry) => entry.file !== undefined)).toEqual([])
  })

  it('C2-N-086, C2-N-087: a finding in a child names the file, a range in it and a path through the include', () => {
    const found = lint('Top.\n\n{{ child.crv }}', { includes: resolver({ 'child.crv': 'One.\n\n[x]()\n' }) })
      .filter((entry) => entry.code === 'empty-link-destination')
    expect(found).toEqual([expect.objectContaining({ file: 'child.crv', range: { startOffset: 6, endOffset: 11 }, path: '/children/1/children/1/children/0' })])
  })

  it('C2-N-087: the same child included twice reports the finding once', () => {
    const found = lint('{{ child.crv }}\n\n{{ child.crv }}', { includes: resolver({ 'child.crv': '[x]()\n' }) })
    expect(found.filter((entry) => entry.code === 'empty-link-destination')).toHaveLength(1)
  })

  it('C2-N-086: a line range is linted over the lines it parsed, with ranges in the file', () => {
    const found = lint('{{ child.crv @lines:3-3 }}', { includes: resolver({ 'child.crv': '[x]()\n\n[y]()\n' }) })
    expect(found.filter((entry) => entry.code === 'empty-link-destination').map((entry) => entry.range)).toEqual([{ startOffset: 7, endOffset: 12 }])
  })

  it('C2-N-086: a section keeps the findings from its first line through its last', () => {
    const found = lint('{{ child.crv #s }}', { includes: resolver({ 'child.crv': '[x]()\n\n{#s}\n[y]()\n\n[z]()\n' }) })
    expect(found.filter((entry) => entry.code === 'empty-link-destination').map((entry) => entry.range)).toEqual([{ startOffset: 12, endOffset: 17 }])
  })

  it('C2-N-087: a finding inside a section points at its node under the include', () => {
    const files = { 'child.crv': '[x]()\n\n{#s}\n[y]()\n\n[z]()\n' }
    const found = lint('Top.\n\n{{ child.crv #s }}', { includes: resolver(files) }).filter((entry) => entry.code === 'empty-link-destination')
    expect(found.map((entry) => [entry.range, entry.path])).toEqual([[{ startOffset: 12, endOffset: 17 }, '/children/1/children/0/children/0']])
    const nested = { 'child.crv': '> a\n>\n> {#h}\n> # H\n>\n> [y]()\n' }
    const inner = lint('{{ child.crv #h }}', { includes: resolver(nested) }).filter((entry) => entry.code === 'empty-link-destination')
    expect(inner.map((entry) => entry.path)).toEqual(['/children/0/children/1/children/0'])
  })

  it('C2-N-088: lines on a delimited table include gets the rows hint', () => {
    expect(lint('{table}\n{{ d.csv @lines:1-2 @code:csv }}').map((entry) => entry.code)).toContain('include-lines-table-rows-hint')
    expect(lint('{table}\n{{ d.csv @rows:1-2 @code:csv }}').map((entry) => entry.code)).not.toContain('include-lines-table-rows-hint')
  })

  it('C2-N-072: attributes above an include without code are reported', () => {
    expect(lint('{#intro .wide}\n{{ a.crv }}').map((entry) => entry.code)).toContain('include-attributes-unused')
    expect(lint('{.wide}\n{{ a.js @code }}').map((entry) => entry.code)).not.toContain('include-attributes-unused')
  })
})

describe('the payload of a code include', () => {
  const files = { 'a.js': 'let ‮a = 1\nlet ‮b = 2\nlet c = 3\n' }

  it('C2-N-086, C2-N-087: a rule that reads the payload of a block runs on the child of a code include, in its file', () => {
    const found = lint('x\n\n{{ a.js @code @lines:2-3 }}', { includes: resolver(files) }).filter((entry) => entry.code === 'bidi-control-in-source')
    expect(found.map((entry) => [entry.file, entry.range, entry.path])).toEqual([['a.js', { startOffset: 17, endOffset: 20 }, '/children/1/children/0']])
  })

  it('C2-N-086: without a code option the file is linted as Carve, once', () => {
    const found = lint('{{ a.js }}', { includes: resolver(files) }).filter((entry) => entry.code === 'bidi-control-in-source')
    expect(found).toHaveLength(2)
  })
})
