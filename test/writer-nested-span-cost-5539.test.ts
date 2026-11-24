import { describe, expect, it } from 'vitest'
import { type Inline } from '../src/ast-nodes.ts'
import { type DocumentNode } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function tree(depth: number, title: string, wrapper: 'span' | 'emphasis' | null = null): DocumentNode {
  let children: Inline[] = []
  for (let at = 0; at < depth; at++) {
    children = [{ type: 'span', attrs: { keyValues: [['title', title]] },
      children: [{ type: 'text', value: '[ ' }, ...children] }]
  }
  if (wrapper === 'span') children = [{ type: 'span', attrs: { keyValues: [['title', 'ab']] }, children }]
  if (wrapper === 'emphasis') children = [{ type: 'emphasis', children }]
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

describe('nested span import cost (carve-js#5539, carve-js#5532)', () => {
  it('places the bracket escapes of a formable span chain together', () => {
    for (const depth of [1, 25, 100]) {
      const { output, stats } = writeTreeWithStats(tree(depth, 'ab'), undefined)
      expect(output.source).toBe(`${'[\\[ '.repeat(depth)}${']{title=ab}'.repeat(depth)}\n`)
      expect(output.diagnostics).toEqual([])
      expect(stats.work.reduce((total, [, chars]) => total + chars, 0)).toBeLessThan(4 * output.source.length)
    }
  })

  it('keeps line-feed attribute losses and source while bounding the repair work', () => {
    for (const wrapper of ['emphasis', 'span'] as const) for (const depth of [1, 3, 25]) {
      const document = tree(depth, 'a\nb', wrapper)
      const fast = writeTreeWithStats(document, undefined, 'plan', false)
      const repaired = writeTreeWithStats(document, undefined, 'repair', false)
      expect(fast.output).toEqual(repaired.output)
      expect(fast.output.diagnostics.map((entry) => entry.code)).toEqual(Array(depth).fill('field-unspellable'))
      expect(fast.stats.work.reduce((total, [, chars]) => total + chars, 0)).toBeLessThan(8 * fast.output.source.length)
    }
  })

  it('keeps ordinary repair for ambiguous bracket and attribute content', () => {
    const span = (title: string, children: Inline[]): Inline =>
      ({ type: 'span', attrs: { keyValues: [['title', title]] }, children })
    const cases: Inline[] = [
      { type: 'emphasis', children: [span('a\nb', [{ type: 'text', value: '[ [ ' },
        span('a\nb', [{ type: 'text', value: '[ x' }])])] },
      span('a\rb', [{ type: 'text', value: '[ ' }]),
      span('ab', [{ type: 'text', value: '[ ' }, span('a\n[b', [{ type: 'text', value: '[ ' }])]),
    ]
    for (const child of cases) {
      const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [child] }] }
      const fast = writeTreeWithStats(document, undefined, 'plan', false)
      const repaired = writeTreeWithStats(document, undefined, 'repair', false)
      expect(fast.output).toEqual(repaired.output)
    }
  })

  it('keeps readback for empty sibling spans and wrappers', () => {
    const opener: Inline = { type: 'span', attrs: { keyValues: [['title', 'ab']] },
      children: [{ type: 'text', value: '[ ' }] }
    for (const sibling of [
      { type: 'span', attrs: { keyValues: [['title', 'ab']] }, children: [] },
      { type: 'emphasis', children: [] },
      { type: 'text', value: '' },
    ] as Inline[]) {
      const document: DocumentNode = { type: 'document', astVersion: '2.0',
        children: [{ type: 'paragraph', children: [opener, sibling] }] }
      const planned = writeTreeWithStats(document, undefined, 'plan', false)
      const repaired = writeTreeWithStats(document, undefined, 'repair', false)
      expect(planned.output).toEqual(repaired.output)
    }
  })

  it('reports authored fields outside the formable span attributes', () => {
    const children: Inline[] = [{ type: 'span', dir: 'rtl', attrs: { keyValues: [['title', 'ab']] },
      children: [{ type: 'text', value: '[ ' }] }]
    const document: DocumentNode = { type: 'document', astVersion: '2.0',
      children: [{ type: 'paragraph', children }] }
    const planned = writeTreeWithStats(document, undefined, 'plan', false)
    const repaired = writeTreeWithStats(document, undefined, 'repair', false)
    expect(planned.output).toEqual(repaired.output)
    expect(planned.output.diagnostics.some((entry) => entry.code === 'field-unspellable')).toBe(true)
  })

  it('keeps readback for attributes that do not retain their field shape', () => {
    for (const attrs of [undefined, { keyValues: [['title', 'ab'], ['title', 'cd']] as [string, string][] },
      { classes: [] as string[] }, { keyValues: [['title', 'a\0b']] as [string, string][] },
      { keyValues: [['title', '\uD800']] as [string, string][] },
      { keyValues: [['ID', 'ab']] as [string, string][] }]) {
      const child: Inline = { type: 'span', ...(attrs === undefined ? {} : { attrs }),
        children: [{ type: 'text', value: '[ ' }] }
      const document: DocumentNode = { type: 'document', astVersion: '2.0',
        children: [{ type: 'paragraph', children: [child] }] }
      expect(writeTreeWithStats(document, undefined, 'plan', false).output)
        .toEqual(writeTreeWithStats(document, undefined, 'repair', false).output)
    }
  })
})
